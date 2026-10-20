import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceHelpFeedback({ setup, sessions, tenant }) {
  await setup.query(
    `insert into help_feedback(tenant_id,slug,locale,page,helpful)
     select $1,'labels','en','/help/[topic]',true from generate_series(1,199)`,
    [tenant],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }) =>
    c
      .query(
        "select submit_help_feedback($1,'labels','en','/help/[topic]',true,null)",
        [tenant],
      )
      .then(
        () => 'saved',
        (error) => {
          if (error.message === 'RATE_LIMITED') return 'limited'
          throw error
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
  assert.deepEqual((await Promise.all(attempts)).sort(), ['limited', 'saved'])
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from help_feedback where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    200,
  )
  console.log(
    'PASS: concurrent help feedback cannot exceed 200 answers per tenant/day.',
  )
}
