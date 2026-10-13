import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function racePosImport({ setup, connectionString }) {
  const actor = randomUUID(),
    seller = randomUUID(),
    clients = []
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `pos-import-${actor}@example.test`],
  )
  try {
    for (let i = 0; i < 2; i++) {
      const c = new pg.Client({
        connectionString,
        application_name: `pos_import_race_${i}`,
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
        'POS race',
        `pos-import-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    await clients[0].query('select register_seller($1,$2,$3,$4,$5)', [
      tenant,
      seller,
      'Synthetic seller',
      'pos-race@example.test',
      '',
    ])
    await clients[0].query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb)`,
      [tenant, randomUUID()],
    )
    await clients[0].query(
      `select store_shopify_connection($1,'synthetic.myshopify.com','Synthetic','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}','read_products',null)`,
      [tenant],
    )
    const context = (
      await clients[0].query('select inventory_import_context($1,$2) value', [
        tenant,
        [seller],
      ])
    ).rows[0].value
    const product = JSON.stringify({
      productId: 'gid://shopify/Product/1',
      variantId: 'gid://shopify/ProductVariant/1',
      title: 'Synthetic coat',
      sku: 'OLD-1',
      barcode: '001234567',
      priceOre: 10000,
      currency: 'SEK',
      quantity: 1,
      active: true,
    })
    await setup.query('begin')
    await setup.query('select id from tenants where id=$1 for update', [tenant])
    const attempts = clients.map((c) =>
      c.query(
        "select commit_pos_import($1,$2,'shopify','synthetic.myshopify.com',$3,'create',null,$4,$5,true) result",
        [tenant, randomUUID(), product, seller, context],
      ),
    )
    let waiting = 0
    for (let i = 0; i < 100; i++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where application_name like 'pos_import_race_%' and wait_event_type='Lock'",
        )
      ).rows[0].n
      if (waiting === 2) break
      await pause(20)
    }
    await setup.query('commit')
    const results = (await Promise.all(attempts)).map((r) => r.rows[0].result)
    assert.equal(waiting, 2)
    assert.deepEqual(results.map((r) => r.created).sort(), [false, true])
    assert.equal(results[0].item.id, results[1].item.id)
    for (const table of ['items', 'pos_product_links', 'reception_sessions']) {
      assert.equal(
        (
          await setup.query(
            `select count(*)::int n from ${table} where tenant_id=$1`,
            [tenant],
          )
        ).rows[0].n,
        1,
      )
    }
    console.log(
      'PASS: simultaneous POS imports create one item, intake and mapping.',
    )
  } finally {
    await setup.query('rollback')
    await Promise.all(clients.map((c) => c.end()))
  }
}
