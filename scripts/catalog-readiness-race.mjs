import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceCatalogReadiness({ setup, connectionString }) {
  const owner = randomUUID(),
    bot = randomUUID(),
    merchant = randomUUID()
  const email = `catalog-race-${bot}@example.test`
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',
    [owner, `owner-${owner}@example.test`, bot, email],
  )
  const clients = [owner, bot, bot].map(
    () => new pg.Client({ connectionString }),
  )
  try {
    for (const [i, client] of clients.entries()) {
      await client.connect()
      await client.query('set role authenticated')
      await client.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: i === 0 ? owner : bot, role: 'authenticated' }),
      ])
    }
    const [a, b, c] = clients
    const tenant = (
      await a.query("select create_tenant('Catalog readiness race',$1,$2) id", [
        `catalog-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id
    await a.query('select enable_zettle_pull($1,$2)', [tenant, merchant])
    await a.query(
      'select publish_zettle_catalog_config($1,$2,null,\'{"store_full":25}\')',
      [tenant, randomUUID()],
    )
    const purchase = randomUUID(),
      item = randomUUID()
    await a.query(
      "select register_purchase($1,$2,'Synthetic source',10000,'Test receipt',false)",
      [tenant, purchase],
    )
    await a.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
      tenant,
      item,
      purchase,
    ])
    await a.query(
      "select save_catalog_automation($1,$2,'paypal',$3,null,true,$4)",
      [tenant, randomUUID(), merchant, email],
    )
    await b.query('select accept_automation_grants()')
    const claim = (client, id = randomUUID()) =>
      client.query("select claim_catalog_export($1,$2,'paypal') job", [
        tenant,
        id,
      ])
    const blocked = await Promise.all([claim(b), claim(c)])
    assert.ok(blocked.every((result) => result.rows[0].job === null))
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from catalog_export_jobs where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      0,
    )

    // Both claims wait for the owner's policy transaction, then see the committed policy.
    await a.query('begin')
    await a.query(
      'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\')',
      [tenant, randomUUID()],
    )
    const pids = await Promise.all(
      [b, c].map((client) => client.query('select pg_backend_pid() pid')),
    )
    const competing = Promise.allSettled([claim(b), claim(c)])
    let waiting = 0
    for (let i = 0; i < 100; i++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where pid=any($1::integer[]) and wait_event_type='Lock'",
          [pids.map((result) => result.rows[0].pid)],
        )
      ).rows[0].n
      if (waiting === 2) break
      await pause(20)
    }
    await a.query('commit')
    const results = await competing
    assert.equal(waiting, 2, 'both claims serialize behind the policy write')
    assert.ok(results.every((result) => result.status === 'fulfilled'))
    const jobs = results
      .map((result) => result.value.rows[0].job)
      .filter(Boolean)
    assert.equal(jobs.length, 1, 'one lease after readiness recovers')
    assert.equal(jobs[0].itemId, item)
    assert.equal(
      (await claim(b, jobs[0].id)).rows[0].job,
      null,
      'same claim never executes twice',
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from catalog_export_jobs where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: blocked catalog scans create no jobs; policy correction and competing claims serialize into one lease.',
    )
  } finally {
    await clients[0].query('rollback').catch(() => {})
    await Promise.all(clients.map((client) => client.end()))
  }
}
