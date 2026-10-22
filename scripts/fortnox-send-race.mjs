import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function raceFortnoxSend({
  setup,
  connectionString,
  automation = false,
}) {
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
    // Automatic sends only consume exports recorded by the daily cutoff.
    // Insert backdated synthetic evidence once; never update immutable exports.
    const exportId = automation
      ? (
          await setup.query(
            `insert into public.accounting_exports(id,tenant_id,day_close_id,map_id,voucher,debit_ore,credit_ore,created_by,created_at)
             select $1,c.tenant_id,c.id,m.id,v->'lines',(v->>'debitOre')::bigint,(v->>'creditOre')::bigint,$2,now()-interval '1 day'
             from public.day_closes c join public.accounting_maps m on m.tenant_id=c.tenant_id
             cross join lateral komisio_private.voucher_for(c,m.map) v where c.id=$3 returning id`,
            [randomUUID(), actor, close],
          )
        ).rows[0].id
      : (
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
    let dailyRun
    if (automation) {
      const worker = randomUUID()
      const email = `worker-${worker}@example.test`
      await setup.query(
        'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
        [worker, email],
      )
      await sessions[0].query(
        "select save_fortnox_send_schedule($1,$2,null,'00:00')",
        [tenant, randomUUID()],
      )
      await sessions[0].query(
        "select enable_automation($1,$2,'fortnox_send',$3)",
        [tenant, randomUUID(), email],
      )
      for (const session of sessions)
        await session.query(
          "select set_config('request.jwt.claims',$1,false)",
          [JSON.stringify({ sub: worker, role: 'authenticated' })],
        )
      await sessions[0].query('select accept_automation_grants()')
      await assert.rejects(
        sessions[0].query('select begin_fortnox_send($1,$2,$3)', [
          tenant,
          randomUUID(),
          exportId,
        ]),
        /FORTNOX_RUN_NOT_ACTIVE/,
      )
      const claims = [randomUUID(), randomUUID()]
      const claimed = await Promise.all(
        sessions.map((session, index) =>
          session.query('select begin_fortnox_automatic_run($1,$2) claimed', [
            tenant,
            claims[index],
          ]),
        ),
      )
      assert.equal(claimed.filter((result) => result.rows[0].claimed).length, 1)
      dailyRun = claims[claimed.findIndex((result) => result.rows[0].claimed)]
    }
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
    if (automation) {
      await sessions[0].query(
        "select finish_fortnox_automatic_run($1,$2,'failed',0)",
        [tenant, dailyRun],
      )
      assert.equal(
        (
          await sessions[1].query(
            'select begin_fortnox_automatic_run($1,$2) claimed',
            [tenant, randomUUID()],
          )
        ).rows[0].claimed,
        false,
      )
      await assert.rejects(
        sessions[0].query(
          "select reconcile_fortnox_send($1,$2,'confirmed_sent','A',42,2026,'Synthetic')",
          [tenant, request],
        ),
        /FORBIDDEN/,
      )
      for (const session of sessions)
        await session.query(
          "select set_config('request.jwt.claims',$1,false)",
          [JSON.stringify({ sub: actor, role: 'authenticated' })],
        )
      console.log(
        'PASS: concurrent automation sends grant one POST; unknown outcomes remain held and automation cannot reconcile.',
      )
    }
    const reconciled = await Promise.allSettled(
      sessions.map((session, index) =>
        session.query(
          "select reconcile_fortnox_send($1,$2,'confirmed_sent','A',$3,2026,'Synthetic checked voucher') result",
          [tenant, request, 42 + index],
        ),
      ),
    )
    assert.equal(
      reconciled.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    const refused = reconciled.find((result) => result.status === 'rejected')
    assert.match(refused.reason.message, /REQUEST_CONFLICT/)
    assert.equal(
      (
        await setup.query(
          "select count(*)::int count from access_events where tenant_id=$1 and action='fortnox.reconciled'",
          [tenant],
        )
      ).rows[0].count,
      1,
    )
    await assert.rejects(
      sessions[0].query('select begin_fortnox_send($1,$2,$3)', [
        tenant,
        randomUUID(),
        exportId,
      ]),
      /FORTNOX_ALREADY_SENT/,
    )
    const revision = (
      await sessions[0].query('select read_fortnox_connection($1) result', [
        tenant,
      ])
    ).rows[0].result.revision
    const refreshes = await Promise.all(
      sessions.map((session, index) =>
        session.query(
          "select refresh_fortnox_tokens($1,$2,$3,'bookkeeping',now()+interval '1 hour') result",
          [
            tenant,
            revision,
            JSON.stringify({
              iv: 'synthetic',
              tag: 'synthetic',
              data: `token-${index}`,
            }),
          ],
        ),
      ),
    )
    assert.equal(
      refreshes.filter(({ rows }) => rows[0].result.status === 'refreshed')
        .length,
      1,
    )
    assert.equal(
      refreshes.filter(
        ({ rows }) => rows[0].result.error === 'FORTNOX_CONNECTION_CHANGED',
      ).length,
      1,
    )
    assert.equal(
      (
        await setup.query(
          "select count(*)::int count from fortnox_connection_events where tenant_id=$1 and kind='refused' and detail->>'expected_revision'=$2",
          [tenant, revision],
        )
      ).rows[0].count,
      1,
    )
    console.log(
      'PASS: concurrent token refresh has one winner and one durable stale-revision refusal.',
    )
    console.log(
      'PASS: one dispatch, unknown outcomes held, one concurrent reconciliation, confirmed vouchers cannot resend.',
    )
    if (!automation) {
      const revisions = []
      for (let version = 2; version <= 3; version++) {
        const purchaseId = (
          await sessions[0].query(
            "select register_purchase($1,$2,'Synthetic',1000,'Race receipt',false) id",
            [tenant, randomUUID()],
          )
        ).rows[0].id
        const itemId = randomUUID()
        await sessions[0].query(
          "select accept_item($1,$2,'purchase',$3,null,2500)",
          [tenant, itemId, purchaseId],
        )
        await sessions[0].query(
          "select record_sale($1,$2,'manual',$3,'2026-09-10T12:00:00Z','SEK',$4,'{}')",
          [
            tenant,
            randomUUID(),
            `revision-${version}`,
            JSON.stringify([{ itemId, priceOre: 2500 }]),
          ],
        )
        const closeId = (
          await sessions[0].query(
            "select generate_day_close($1,$2,'2026-09-10') id",
            [tenant, randomUUID()],
          )
        ).rows[0].id
        revisions.push(
          (
            await sessions[0].query('select export_day_close($1,$2,$3) id', [
              tenant,
              randomUUID(),
              closeId,
            ])
          ).rows[0].id,
        )
      }
      const attempts = await Promise.allSettled(
        sessions.map((session, index) =>
          session.query('select begin_fortnox_send($1,$2,$3,$4) result', [
            tenant,
            randomUUID(),
            revisions[index],
            request,
          ]),
        ),
      )
      assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1)
      assert.match(
        attempts.find((r) => r.status === 'rejected').reason.message,
        /FORTNOX_DAY_UNRESOLVED/,
      )
      const winner = attempts.find((r) => r.status === 'fulfilled').value
        .rows[0].result
      assert.equal(
        winner.debitOre,
        winner.exportId === revisions[0] ? 2500 : 5000,
      )
      assert.equal(winner.creditOre, winner.debitOre)
      console.log(
        'PASS: concurrent revised-day deliveries freeze one exact difference and hold the other version.',
      )
    }
  } finally {
    await Promise.allSettled(sessions.map((session) => session.end()))
  }
}
