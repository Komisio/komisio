import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'
export async function raceStorePolicy({ setup, sessions, tenant }) {
  const body = (
    await sessions[0].c.query('select current_store_policy($1) p', [tenant])
  ).rows[0].p.policy
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }, i) =>
    c
      .query('select publish_store_policy($1,$2,null,$3)', [
        tenant,
        randomUUID(),
        { ...body, commissionRatePercent: 40 + i },
      ])
      .then(
        () => 'published',
        (e) => {
          if (e.message === 'POLICY_CHANGED') return 'stale'
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
  assert.deepEqual((await Promise.all(attempts)).sort(), ['published', 'stale'])
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from store_policy_versions where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    1,
  )
  console.log(
    'PASS: concurrent policy publications have one winner and one stale version; no overwritten terms.',
  )
}
