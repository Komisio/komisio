import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function raceFortnoxSend({ setup, connectionString }) {
  const actor = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `send-${actor}@example.test`],
  )
  const sessions = []
  try {
    for (let index = 0; index < 2; index++) {
      const session = new pg.Client({ connectionString })
      sessions.push(session)
      await session.connect()
      await session.query('set role authenticated')
      await session.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
    }
    const tenant = (
      await sessions[0].query('select create_tenant($1,$2,$3) id', [
        'Send race',
        `send-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    const close = randomUUID()
    await sessions[0].query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy')||'{"vatModeStoreOwned":"store_full"}')`,
      [tenant, randomUUID()],
    )
    const purchase = (
      await sessions[0].query(
        "select register_purchase($1,$2,'Synthetic',1000,'Synthetic receipt',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const item = randomUUID()
    await sessions[0].query(
      "select accept_item($1,$2,'purchase',$3,null,2500)",
      [tenant, item, purchase],
    )
    await sessions[0].query(
      "select record_sale($1,$2,'manual','send-race','2026-09-10T10:00:00Z','SEK',$3,'{}')",
      [
        tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 2500 }]),
      ],
    )
    await sessions[0].query("select generate_day_close($1,$2,'2026-09-10')", [
      tenant,
      close,
    ])
    await sessions[0].query(
      `select publish_accounting_map($1,$2,null,'{"grossOre":{"account":"1930","side":"debit"},"mode:store_full:netOre":{"account":"3010","side":"credit"},"mode:store_full:vatOre":{"account":"2610","side":"credit"}}')`,
      [tenant, randomUUID()],
    )
    const exportId = (
      await sessions[0].query('select export_day_close($1,$2,$3) id', [
        tenant,
        randomUUID(),
        close,
      ])
    ).rows[0].id
    await sessions[0].query(
      `select store_fortnox_connection($1,'synthetic','Synthetic','','{"iv":"a","tag":"b","data":"c"}','bookkeeping',now()+interval '1 hour')`,
      [tenant],
    )
    const request = randomUUID()
    const results = await Promise.all(
      sessions.map((session) =>
        session.query('select begin_fortnox_send($1,$2,$3) result', [
          tenant,
          request,
          exportId,
        ]),
      ),
    )
    assert.equal(
      results.filter((result) => result.rows[0].result.dispatchAllowed).length,
      1,
    )
    await assert.rejects(
      sessions[1].query('select begin_fortnox_send($1,$2,$3)', [
        tenant,
        randomUUID(),
        exportId,
      ]),
      /FORTNOX_SEND_IN_PROGRESS/,
    )
    await sessions[0].query(
      "select complete_fortnox_send($1,$2,'failed','',null,null,'FORTNOX_OUTCOME_UNKNOWN','')",
      [tenant, request],
    )
    await assert.rejects(
      sessions[1].query('select begin_fortnox_send($1,$2,$3)', [
        tenant,
        randomUUID(),
        exportId,
      ]),
      /FORTNOX_OUTCOME_UNKNOWN/,
    )
    console.log(
      'PASS: concurrent Fortnox retries grant one POST; ambiguous outcomes cannot open another send.',
    )
  } finally {
    await Promise.allSettled(sessions.map((session) => session.end()))
  }
}
