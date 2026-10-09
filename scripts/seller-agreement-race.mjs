import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function raceSellerAgreement({ setup, connectionString }) {
  const owner = randomUUID(),
    user = randomUUID(),
    version = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',
    [owner, `${owner}@example.test`, user, `${user}@example.test`],
  )
  await setup.query('begin')
  await setup.query('set local role authenticated')
  await setup.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: owner, role: 'authenticated' }),
  ])
  const tenant = (
    await setup.query('select create_tenant($1,$2,$3) id', [
      'Agreement race',
      `agreement-${owner}`,
      randomUUID(),
    ])
  ).rows[0].id
  const seller = (
    await setup.query('select register_seller($1,$2,$3,$4,$5) id', [
      tenant,
      randomUUID(),
      'Synthetic seller',
      `${user}@example.test`,
      '',
    ])
  ).rows[0].id
  await setup.query(
    "select publish_seller_agreement($1,$2,null,'TEST terms','Fictional test agreement','en',false)",
    [tenant, version],
  )
  await setup.query('commit')
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: 'authenticated' }),
      ])
    }
    const results = await Promise.all(
      clients.map((c) =>
        c.query('select accept_my_seller_agreement($1,$2,$3,$4) id', [
          tenant,
          randomUUID(),
          seller,
          version,
        ]),
      ),
    )
    assert.equal(results[0].rows[0].id, results[1].rows[0].id)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_agreement_evidence where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: simultaneous seller agreement acceptances preserve one immutable evidence row.',
    )
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
