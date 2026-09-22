import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceStoreCreation({ setup, sessions }) {
  const request = randomUUID()
  const uid = sessions[0].uid
  const claims = (sub) => JSON.stringify({ sub, role: 'authenticated' })
  await sessions[1].c.query(
    "select set_config('request.jwt.claims',$1,false)",
    [claims(uid)],
  )
  try {
    await setup.query('begin')
    await setup.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      uid + request,
    ])
    const attempts = sessions.map(({ c }, i) =>
      c.query('select create_tenant_with_locale($1,$2,$3,$4) id', [
        'Creation race',
        `creation-${request}`,
        request,
        i ? 'dk' : 'no',
      ]),
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
    const results = await Promise.all(attempts)
    assert.equal(waiting, 2)
    const tenant = results[0].rows[0].id
    assert.equal(results[1].rows[0].id, tenant)
    const policies = (
      await setup.query(
        'select policy from store_policy_versions where tenant_id=$1',
        [tenant],
      )
    ).rows
    assert.equal(policies.length, 1)
    assert.ok(['NOK', 'DKK'].includes(policies[0].policy.currency))
    console.log(
      'PASS: concurrent store creation persists one tenant and one initial currency policy.',
    )
  } finally {
    await sessions[1].c.query(
      "select set_config('request.jwt.claims',$1,false)",
      [claims(sessions[1].uid)],
    )
  }
}
