import pg from 'pg'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

export async function raceZettleImage({ setup, connectionString }) {
  const actor = randomUUID(),
    merchant = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `image-${actor}@example.test`],
  )
  const connections = []
  try {
    for (let index = 0; index < 2; index++) {
      const connection = new pg.Client({ connectionString })
      await connection.connect()
      connections.push(connection)
      await connection.query('set role authenticated')
      await connection.query(
        "select set_config('request.jwt.claims',$1,false)",
        [JSON.stringify({ sub: actor, role: 'authenticated' })],
      )
    }
    const [first, second] = connections
    const tenant = (
      await first.query('select create_tenant($1,$2,$3) id', [
        'Image race',
        `image-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    await first.query('select enable_zettle_pull($1,$2)', [tenant, merchant])
    await first.query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy')||'{"vatModeConsignmentPrivate":"consignment_margin"}')`,
      [tenant, randomUUID()],
    )
    await first.query(
      `select publish_zettle_catalog_config($1,$2,null,'{"consignment_margin":0}')`,
      [tenant, randomUUID()],
    )
    const seller = (
      await first.query(
        "select register_seller($1,$2,'Synthetic','image-seller@example.test','') id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const agreement = (
      await first.query(
        "select publish_seller_agreement($1,$2,null,'Test','Synthetic terms','en',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    await first.query(
      "select record_agreement_evidence($1,$2,$3,$4,'Synthetic evidence')",
      [tenant, randomUUID(), seller, agreement],
    )
    for (const sameRequest of [true, false]) {
      const session = randomUUID(),
        photo = randomUUID(),
        price = randomUUID(),
        item = randomUUID(),
        request = randomUUID()
      await first.query('select create_reception_session($1,$2,$3)', [
        tenant,
        session,
        seller,
      ])
      const reference = `${tenant}/${session}/${photo}.jpg`
      await setup.query(
        "insert into storage.objects(bucket_id,name) values('reception-photos',$1)",
        [reference],
      )
      await first.query('select save_reception_sources($1,$2,$3,0,$4)', [
        tenant,
        randomUUID(),
        session,
        JSON.stringify([
          { id: photo, kind: 'photo', reference, observation: '' },
          {
            id: price,
            kind: 'price-evidence',
            reference: 'Staff',
            observation: 'Test',
          },
        ]),
      ])
      await first.query(
        "select publish_reception_review($1,$2,$3,1,null,$4,$5,now()+interval '1 day')",
        [
          tenant,
          randomUUID(),
          session,
          agreement,
          JSON.stringify({
            attributes: [
              {
                slug: 'description',
                definitionVersion: 1,
                value: 'Test jacket',
                sourceIds: [photo],
                certainty: 'observed',
              },
            ],
            price: {
              currency: 'SEK',
              amount: '100.00',
              rationale: 'Test',
              sourceIds: [price],
            },
            questions: [],
          }),
        ],
      )
      await first.query("select receive_garment($1,$2,$3,'')", [
        tenant,
        randomUUID(),
        session,
      ])
      await first.query(
        "select accept_item($1,$2,'reception_review',$3,1,10000)",
        [tenant, item, session],
      )
      await first.query(
        "select finish_zettle_product($1,prepare_zettle_product($1,$2),'synced',null)",
        [tenant, item],
      )
      const claims = await Promise.all([
        first.query('select prepare_zettle_image($1,$2,$3,$4) claim', [
          tenant,
          request,
          item,
          merchant,
        ]),
        second.query('select prepare_zettle_image($1,$2,$3,$4) claim', [
          tenant,
          sameRequest ? request : randomUUID(),
          item,
          merchant,
        ]),
      ])
      const results = claims.map((result) => result.rows[0].claim)
      assert.equal(results.filter((claim) => claim.fresh).length, 1)
      assert.equal(results[0].id, results[1].id)
      await Promise.all(
        connections.map((connection) =>
          connection.query('select record_zettle_image_upload($1,$2,$3)', [
            tenant,
            results[0].id,
            'https://image.izettle.com/product/synthetic.jpg',
          ]),
        ),
      )
      await Promise.all(
        connections.map((connection) =>
          connection.query('select finish_zettle_image($1,$2)', [
            tenant,
            results[0].id,
          ]),
        ),
      )
      assert.equal(
        (
          await setup.query(
            'select count(*)::int total from zettle_image_outcomes where intent_id=$1',
            [results[0].id],
          )
        ).rows[0].total,
        1,
      )
    }
    assert.equal(
      (
        await setup.query(
          'select count(*)::int total from zettle_stock_intents where tenant_id=$1',
          [tenant],
        )
      ).rows[0].total,
      0,
    )
    console.log(
      'PASS: concurrent image commands grant one upload and acknowledge once, without granting stock.',
    )
  } finally {
    await Promise.all(connections.map((connection) => connection.end()))
  }
}
