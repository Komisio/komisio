import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceSellerRegistration({ setup, connectionString }) {
  const owner = randomUUID(),
    seller = randomUUID(),
    agreement = randomUUID()
  const address = `${seller}@example.test`
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',
    [owner, `${owner}@example.test`, seller, address],
  )
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  const as = async (c, uid) => {
    await c.query('set role authenticated')
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ])
  }
  try {
    for (const c of clients) await c.connect()
    await as(clients[0], owner)
    const tenant = (
      await clients[0].query('select create_tenant($1,$2,$3) id', [
        'Synthetic registration race',
        `registration-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id
    await clients[0].query(
      "select publish_seller_agreement($1,$2,null,'Synthetic agreement','Synthetic text','en',true)",
      [tenant, agreement],
    )
    const link = randomUUID()
    await clients[0].query(
      "select set_seller_registration($1,$2,null,'enable')",
      [tenant, link],
    )
    const token = (
      await clients[0].query('select seller_registration_settings($1) s', [
        tenant,
      ])
    ).rows[0].s.token
    for (const c of clients) await as(c, seller)
    await setup.query('begin')
    await setup.query('select 1 from tenants where id=$1 for update', [tenant])
    const submissions = clients.map((c) =>
      c.query(
        "select submit_seller_registration($1,$2,'Synthetic seller','0700000000',$3,null,true)",
        [token, randomUUID(), agreement],
      ),
    )
    await pause(100)
    await setup.query('commit')
    await Promise.all(submissions)
    const applications = (
      await setup.query(
        'select id from seller_registrations where tenant_id=$1',
        [tenant],
      )
    ).rows
    assert.equal(
      applications.length,
      1,
      'simultaneous submissions produce one pending application',
    )
    const application = applications[0].id
    for (const c of clients) await as(c, owner)
    // A normal staff registration commits while approval is waiting for the tenant.
    await clients[0].query('begin')
    const existing = randomUUID()
    await clients[0].query(
      "select register_seller($1,$2,'Staff registered',$3,'')",
      [tenant, existing, address],
    )
    const approval = clients[1].query(
      'select review_seller_registration($1,$2,$3,true) id',
      [tenant, randomUUID(), application],
    )
    await pause(100)
    await clients[0].query('commit')
    assert.equal((await approval).rows[0].id, existing)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from sellers where tenant_id=$1 and email=$2',
          [tenant, address],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          'select created_seller from seller_registration_reviews where registration_id=$1',
          [application],
        )
      ).rows[0].created_seller,
      false,
    )
    // A different applicant exercises competing approval/rejection and link revocation.
    const second = randomUUID()
    await setup.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [second, `${second}@example.test`],
    )
    await as(clients[1], second)
    const nextApplication = randomUUID()
    await clients[1].query(
      "select submit_seller_registration($1,$2,'Second seller','0700000001',$3,null,true)",
      [token, nextApplication, agreement],
    )
    await as(clients[1], owner)
    await setup.query('begin')
    await setup.query('select 1 from tenants where id=$1 for update', [tenant])
    const decisions = clients.map((c, i) =>
      c
        .query('select review_seller_registration($1,$2,$3,$4)', [
          tenant,
          randomUUID(),
          nextApplication,
          i === 0,
        ])
        .then(
          () => 'accepted',
          (e) => {
            assert.equal(e.message, 'REGISTRATION_REVIEWED')
            return 'already-reviewed'
          },
        ),
    )
    await pause(100)
    await setup.query('commit')
    assert.deepEqual((await Promise.all(decisions)).sort(), [
      'accepted',
      'already-reviewed',
    ])
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_registration_reviews where registration_id=$1',
          [nextApplication],
        )
      ).rows[0].n,
      1,
    )
    await clients[0].query('begin')
    await clients[0].query(
      "select set_seller_registration($1,$2,$3,'rotate')",
      [tenant, randomUUID(), link],
    )
    await as(clients[1], second)
    const stale = clients[1]
      .query(
        "select submit_seller_registration($1,$2,'Second seller','0700000001',$3,null,true)",
        [token, randomUUID(), agreement],
      )
      .then(
        () => 'unexpected',
        (e) => e.message,
      )
    await pause(100)
    await clients[0].query('commit')
    assert.equal(await stale, 'REGISTRATION_DISABLED')
    console.log(
      'PASS: registration submissions, staff duplicate reuse, review decisions and link rotation serialize correctly.',
    )
  } finally {
    await setup.query('rollback')
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
