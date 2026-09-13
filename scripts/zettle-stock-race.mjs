import pg from 'pg'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
export async function raceZettleStock({ setup, connectionString }) {
  const actor = randomUUID(),
    merchant = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `stock-${actor}@example.test`],
  )
  async function connect() {
    const c = new pg.Client({ connectionString })
    await c.connect()
    await c.query('set role authenticated')
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
    return c
  }
  const a = await connect(),
    b = await connect()
  try {
    const tenant = (
      await a.query('select create_tenant($1,$2,$3) id', [
        'Stock race',
        `stock-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    await a.query('select enable_zettle_pull($1,$2)', [tenant, merchant])
    await a.query(
      'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\'::jsonb)',
      [tenant, randomUUID()],
    )
    await a.query(
      'select publish_zettle_catalog_config($1,$2,null,\'{"store_full":25}\')',
      [tenant, randomUUID()],
    )
    const locations = Object.fromEntries(
      ['STORE', 'SUPPLIER', 'SOLD', 'BIN'].map((k) => [k, randomUUID()]),
    )
    for (const sameRequest of [true, false]) {
      const purchase = randomUUID(),
        item = randomUUID(),
        request = randomUUID()
      await a.query(
        "select register_purchase($1,$2,'Synthetic source',1000,'Synthetic receipt',true)",
        [tenant, purchase],
      )
      await a.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
        tenant,
        item,
        purchase,
      ])
      let job = (
        await a.query('select prepare_zettle_product($1,$2) id', [tenant, item])
      ).rows[0].id
      const legacy = randomUUID()
      await setup.query(
        `insert into zettle_product_exports(id,tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,created_by)
        select $1,tenant_id,item_id,price_id,config_id,policy_version,$2,$3,
        jsonb_set(jsonb_set(payload,'{uuid}',to_jsonb($2::uuid)),'{variants,0,uuid}',to_jsonb($3::uuid)),created_by
        from zettle_product_exports where id=$4`,
        [legacy, randomUUID(), randomUUID(), job],
      )
      await a.query(
        "select finish_zettle_product($1,$2,'failed','ZETTLE_PRODUCT_UUID_REJECTED')",
        [tenant, legacy],
      )
      const corrections = await Promise.all(
        [a, b].map((c) =>
          c.query('select repair_zettle_product_identity($1,$2) id', [
            tenant,
            legacy,
          ]),
        ),
      )
      job = corrections[0].rows[0].id
      assert.equal(job, corrections[1].rows[0].id)
      assert.notEqual(job, legacy)
      const fixed = await a.query(
        'select product_id from zettle_product_exports where id=$1',
        [job],
      )
      assert.equal(fixed.rows[0].product_id[14], '1')
      const results = await Promise.all(
        [a, b].map((c, i) =>
          c.query('select claim_zettle_stock($1,$2,$3,$4,$5) claim', [
            tenant,
            i === 0 || sameRequest ? request : randomUUID(),
            job,
            merchant,
            locations,
          ]),
        ),
      )
      assert.equal(results.filter((r) => r.rows[0].claim.fresh).length, 1)
      assert.equal(results[0].rows[0].claim.id, results[1].rows[0].claim.id)
      const replay = await a.query(
        'select claim_zettle_stock($1,$2,$3,$4,$5) claim',
        [tenant, randomUUID(), job, merchant, locations],
      )
      assert.equal(replay.rows[0].claim.fresh, false)
    }
    assert.equal(
      (
        await a.query(
          'select count(*)::int n from zettle_stock_intents where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      2,
    )
    console.log(
      'PASS: concurrent identity corrections converge; one initial stock grant across concurrent identical and different request IDs; replays never grant stock.',
    )
  } finally {
    await a.end()
    await b.end()
  }
}
