import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceDayCloseAutomation({ setup, connectionString }) {
  const owner = randomUUID(),
    worker = randomUUID()
  const email = `${worker}@example.test`
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',
    [owner, `${owner}@example.test`, worker, email],
  )
  const clients = [owner, worker, worker].map(
    () => new pg.Client({ connectionString }),
  )
  try {
    for (const [i, c] of clients.entries()) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: i === 0 ? owner : worker,
          role: 'authenticated',
        }),
      ])
    }
    const [a, b, c] = clients
    const tenant = (
      await a.query('select create_tenant($1,$2,$3) id', [
        'Day close race',
        `day-close-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id
    const grant = randomUUID()
    await a.query("select enable_automation($1,$2,'day_close',$3)", [
      tenant,
      grant,
      email,
    ])
    await b.query('select accept_automation_grants()')
    await setup.query(
      "update automation_grants set enabled_at=((now() at time zone 'Europe/Stockholm')::date-1)::timestamp at time zone 'Europe/Stockholm' where id=$1",
      [grant],
    )
    await a.query(
      'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\'::jsonb)',
      [tenant, randomUUID()],
    )
    const purchase = randomUUID(),
      item = randomUUID()
    await a.query(
      "select register_purchase($1,$2,'Synthetic shirt',10000,'Race receipt',false)",
      [tenant, purchase],
    )
    await a.query("select accept_item($1,$2,'purchase',$3,null,20000)", [
      tenant,
      item,
      purchase,
    ])
    await a.query(
      "select record_sale($1,$2,'manual','automatic-close-race',((now() at time zone 'Europe/Stockholm')::date-1)::timestamp at time zone 'Europe/Stockholm','SEK',$3::jsonb)",
      [
        tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    async function blocked(client) {
      const pid = client.processID
      for (let i = 0; i < 200; i++) {
        if (
          (
            await setup.query(
              'select wait_event_type from pg_stat_activity where pid=$1',
              [pid],
            )
          ).rows[0]?.wait_event_type === 'Lock'
        )
          return
        await pause(10)
      }
      throw Error('Day-close competitor did not reach tenant lock')
    }
    const run = (client, id = randomUUID()) =>
      client.query('select run_automatic_day_closes($1,$2) result', [
        tenant,
        id,
      ])
    await b.query('begin')
    const first = await run(b)
    const concurrent = run(c)
    await blocked(c)
    await b.query('commit')
    assert.equal(first.rows[0].result.created, 1)
    assert.equal((await concurrent).rows[0].result.unchanged, 1)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from day_closes where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )

    const retryId = randomUUID()
    await b.query('begin')
    const original = await run(b, retryId)
    const retry = run(c, retryId)
    await blocked(c)
    await b.query('commit')
    assert.deepEqual((await retry).rows[0].result, original.rows[0].result)
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from access_events where tenant_id=$1 and target_id=$2 and action='day_close.automatic_run'",
          [tenant, retryId],
        )
      ).rows[0].n,
      1,
    )

    await a.query('begin')
    await a.query(
      "select generate_day_close($1,$2,(now() at time zone 'Europe/Stockholm')::date-1)",
      [tenant, randomUUID()],
    )
    const afterManual = run(b)
    await blocked(b)
    await a.query('commit')
    assert.equal((await afterManual).rows[0].result.unchanged, 1)

    await a.query('begin')
    await a.query("select disable_automation($1,'day_close')", [tenant])
    const revoked = run(b, retryId).then(
      () => null,
      (error) => error,
    )
    await blocked(b)
    await a.query('commit')
    assert.match((await revoked).message, /FORBIDDEN/)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from accounting_exports where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      0,
    )
    console.log(
      'PASS: automatic/manual day-close races preserve one version, replay once and respect concurrent revocation.',
    )
  } finally {
    for (const client of clients) {
      await client.query('rollback').catch(() => {})
      await client.end()
    }
  }
}
