import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function raceRegistrationCategory({ setup, connectionString }) {
  const actor = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `category-race-${actor}@example.test`],
  )
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
    }
    const a = clients[0]
    const tenant = (
      await a.query("select create_tenant('Category race',$1,$2) id", [
        `cat-race-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await a.query(
        "select register_seller($1,$2,'Synthetic seller',$3,'') id",
        [tenant, randomUUID(), `${randomUUID()}@example.test`],
      )
    ).rows[0].id
    const agreement = (
      await a.query(
        "select publish_seller_agreement($1,$2,null,'Terms','Test only','en',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    await a.query(
      "select record_agreement_evidence($1,$2,$3,$4,'Signed test')",
      [tenant, randomUUID(), seller, agreement],
    )
    await a.query(
      'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeConsignmentPrivate":"consignment_margin"}\')',
      [tenant, randomUUID()],
    )
    const category = randomUUID(),
      request = randomUUID()
    await a.query('select create_item_category($1,$2,$3,$4)', [
      tenant,
      category,
      'Race books',
      { en: 'Race books' },
    ])
    const session = (
      await a.query('select create_reception_session($1,$2,$3) id', [
        tenant,
        randomUUID(),
        seller,
      ])
    ).rows[0].id
    const received = await Promise.all(
      clients.map((c) =>
        c.query(
          'select quick_receive_categorized($1,$2,$3,$4,0,\'{"description":"Race item"}\',10000,null,null,null,$5) result',
          [tenant, request, session, seller, category],
        ),
      ),
    )
    assert.deepEqual(received[0].rows, received[1].rows)
    const item = received[0].rows[0].result.itemId
    const rows = (
      await setup.query(
        "select (select count(*)::int from items where tenant_id=$1 and origin_id=$2) items,(select count(*)::int from item_category_links where id=komisio_private.derived_uuid($3||':category')) receipts,(select category_id from item_category_links where item_id=$4 order by seq desc limit 1) category",
        [tenant, session, request, item],
      )
    ).rows[0]
    assert.deepEqual(rows, { items: 1, receipts: 1, category })
    console.log(
      'PASS: simultaneous categorized reception retries produce one item and one explicit category receipt.',
    )
  } finally {
    await Promise.all(clients.map((c) => c.end()))
  }
}
