import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/** Two real sessions compete for the same provider attempt and confirmation. */
export async function raceEconomicSend({ setup, connectionString }) {
  const actor = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `economic-${actor}@example.test`],
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
      await sessions[0].query(
        "select create_tenant_with_locale($1,$2,$3,'dk') id",
        ['Economic race', `economic-${actor}`, randomUUID()],
      )
    ).rows[0].id
    await sessions[0].query(
      `select store_economic_connection($1,123456,'Synthetic','','DKK','{"iv":"a","tag":"b","data":"c"}')`,
      [tenant],
    )
    const close = randomUUID(),
      map = randomUUID()
    await setup.query(
      "insert into day_closes(id,tenant_id,close_date,version,gross_ore,commission_ore,generated_by) values($1,$2,'2026-10-01',1,10000,10000,$3)",
      [close, tenant, actor],
    )
    await sessions[0].query(
      `select publish_economic_map($1,$2,null,123456,1,'{"grossOre":{"account":"10000","side":"debit","vatCode":"Z0"},"commissionOre":{"account":"30000","side":"credit","vatCode":"Z0"}}')`,
      [tenant, map],
    )
    const exports = await Promise.all(
      sessions.map((session) =>
        session.query('select export_economic_day_close($1,$2,$3) id', [
          tenant,
          randomUUID(),
          close,
        ]),
      ),
    )
    assert.equal(exports[0].rows[0].id, exports[1].rows[0].id)
    const exportId = exports[0].rows[0].id,
      request = randomUUID()
    const claimed = await Promise.all(
      sessions.map((session) =>
        session.query('select begin_economic_send($1,$2,$3) result', [
          tenant,
          request,
          exportId,
        ]),
      ),
    )
    assert.equal(
      claimed.filter(({ rows }) => rows[0].result.dispatchAllowed).length,
      1,
    )
    await assert.rejects(
      sessions[1].query('select begin_economic_send($1,$2,$3)', [
        tenant,
        randomUUID(),
        exportId,
      ]),
      /ECONOMIC_SEND_IN_PROGRESS/,
    )
    await sessions[0].query(
      "select complete_economic_send($1,$2,'failed',null,'ECONOMIC_OUTCOME_UNKNOWN','ECONOMIC_CONNECTION_FAILED',null)",
      [tenant, request],
    )
    await assert.rejects(
      sessions[1].query('select begin_economic_send($1,$2,$3)', [
        tenant,
        randomUUID(),
        exportId,
      ]),
      /ECONOMIC_OUTCOME_UNKNOWN/,
    )
    const confirmations = await Promise.allSettled(
      sessions.map((session, index) =>
        session.query(
          "select confirm_economic_send($1,$2,1,$3,'Checked synthetic journal')",
          [tenant, request, 42 + index],
        ),
      ),
    )
    assert.equal(
      confirmations.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    assert.match(
      confirmations.find((result) => result.status === 'rejected').reason
        .message,
      /REQUEST_CONFLICT/,
    )
    await assert.rejects(
      sessions[0].query('select begin_economic_send($1,$2,$3)', [
        tenant,
        randomUUID(),
        exportId,
      ]),
      /ECONOMIC_ALREADY_SENT/,
    )
    console.log(
      'PASS: e-conomic has one export, one dispatch and one confirmation under concurrent requests; unknown outcomes stay held.',
    )
  } finally {
    await Promise.allSettled(sessions.map((session) => session.end()))
  }
}
