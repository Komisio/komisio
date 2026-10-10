import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

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
    for (const c of clients)
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: owner, role: 'authenticated' }),
      ])
    const next = randomUUID(),
      registration = randomUUID()
    const profile = {
      name: 'Combined TEST',
      email: '',
      phone: '010123',
      nationalId: '',
      addressLine1: '',
      addressLine2: '',
      postalCode: '',
      city: '',
      country: '',
      language: '',
      notes: '',
    }
    const pid = (await clients[1].query('select pg_backend_pid() pid')).rows[0]
      .pid
    await clients[0].query('begin')
    await clients[0].query(
      "select publish_seller_agreement($1,$2,$3,'New TEST terms','New fictional terms','sv',false)",
      [tenant, next, version],
    )
    const pending = clients[1]
      .query('select save_seller_with_agreement($1,$2,null,null,$3,$4,$5)', [
        tenant,
        registration,
        profile,
        version,
        'Paper TEST',
      ])
      .then(
        () => null,
        (error) => error.message,
      )
    let blocked = false
    for (let n = 0; n < 100; n++) {
      blocked = (
        await setup.query(
          "select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",
          [pid],
        )
      ).rows[0]?.blocked
      if (blocked) break
      await pause(20)
    }
    await clients[0].query('commit')
    assert.equal(
      blocked,
      true,
      'combined registration waits for concurrent publication',
    )
    assert.match(await pending, /AGREEMENT_CHANGED/)
    assert.equal(
      (
        await setup.query('select count(*)::int n from sellers where id=$1', [
          registration,
        ])
      ).rows[0].n,
      0,
    )
    const concurrent = await Promise.all(
      clients.map((c) =>
        c.query(
          'select save_seller_with_agreement($1,$2,null,null,$3,$4,$5) id',
          [tenant, registration, profile, next, 'Paper TEST'],
        ),
      ),
    )
    assert.equal(concurrent[0].rows[0].id, registration)
    assert.equal(concurrent[1].rows[0].id, registration)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_agreement_evidence where seller_id=$1',
          [registration],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: combined seller registration waits for publication, rolls back obsolete terms and deduplicates concurrent retries.',
    )
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
