import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceInventoryImport({ setup, connectionString }) {
  const actor = randomUUID(),
    seller = randomUUID(),
    clients = []
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `import-${actor}@example.test`],
  )
  try {
    for (let i = 0; i < 2; i++) {
      const c = new pg.Client({
        connectionString,
        application_name: `inventory_import_race_${i}`,
      })
      await c.connect()
      clients.push(c)
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
    }
    const tenant = (
      await clients[0].query('select create_tenant($1,$2,$3) id', [
        'Import race',
        `import-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    await clients[0].query('select register_seller($1,$2,$3,$4,$5)', [
      tenant,
      seller,
      'Synthetic seller',
      'import-race@example.test',
      '',
    ])
    await clients[0].query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb)`,
      [tenant, randomUUID()],
    )
    const context = (
      await clients[0].query('select inventory_import_context($1,$2) value', [
        tenant,
        [seller],
      ])
    ).rows[0].value
    const rows = JSON.stringify([
      {
        reference: 'SOURCE-001',
        sellerId: seller,
        email: '',
        description: 'Synthetic shirt',
        priceOre: 10000,
        currency: 'SEK',
      },
    ])
    await setup.query('begin')
    await setup.query('select id from tenants where id=$1 for update', [tenant])
    const attempts = clients.map((c) =>
      c.query('select import_inventory($1,$2,$3,$4,$5,true) result', [
        tenant,
        randomUUID(),
        'stock.csv',
        rows,
        context,
      ]),
    )
    let waiting = 0
    for (let i = 0; i < 100; i++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where application_name like 'inventory_import_race_%' and wait_event_type='Lock'",
        )
      ).rows[0].n
      if (waiting === 2) break
      await pause(20)
    }
    await setup.query('commit')
    const results = (await Promise.all(attempts)).map((r) => r.rows[0].result)
    assert.equal(waiting, 2)
    assert.deepEqual(results.map((r) => r.created).sort(), [0, 1])
    assert.deepEqual(results.map((r) => r.skipped).sort(), [0, 1])
    assert.equal(results[0].items[0].itemId, results[1].items[0].itemId)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from items where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: concurrent inventory imports create one item per source reference.',
    )
  } finally {
    await setup.query('rollback')
    await Promise.all(clients.map((c) => c.end()))
  }
}
