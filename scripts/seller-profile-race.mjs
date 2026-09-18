import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'
export async function raceSellerProfile({ setup, sessions, tenant }) {
  const seller = randomUUID()
  await sessions[0].c.query('select register_seller($1,$2,$3,$4,$5)', [
    tenant,
    seller,
    'Profile race',
    'race@example.test',
    '',
  ])
  const profile = {
    name: 'Changed',
    email: 'race@example.test',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: '',
    language: '',
    notes: '',
  }
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }, i) =>
    c
      .query('select save_seller_profile($1,$2,$3,0,$4)', [
        tenant,
        randomUUID(),
        seller,
        { ...profile, name: `Changed ${i}` },
      ])
      .then(
        () => 'saved',
        (e) => {
          if (e.message === 'PROFILE_CHANGED') return 'stale'
          throw e
        },
      ),
  )
  let waiting = 0
  for (let i = 0; i < 100; i++) {
    waiting = (
      await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
      )
    ).rows[0].n
    if (waiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  assert.equal(waiting, 2)
  assert.deepEqual((await Promise.all(attempts)).sort(), ['saved', 'stale'])
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from seller_profile_versions where seller_id=$1',
        [seller],
      )
    ).rows[0].n,
    2,
  )
  console.log(
    'PASS: concurrent seller profile edits preserve the original and have one winner.',
  )
}
