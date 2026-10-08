import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'
export async function raceSellerSubmission({ setup, sessions, tenant }) {
  const seller = randomUUID(),
    submission = randomUUID()
  await sessions[0].c.query(
    "select register_seller($1,$2,'Submission race','submission-race@example.test','')",
    [tenant, seller],
  )
  const actor = (await sessions[0].c.query('select auth.uid() as id')).rows[0]
    .id
  await setup.query(
    "insert into seller_submissions(id,tenant_id,seller_id,description,photos,created_by) values($1,$2,$3,'Synthetic jacket',$4,$5)",
    [submission, tenant, seller, JSON.stringify(['synthetic.jpg']), actor],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }, i) =>
    c
      .query('select review_seller_submission($1,$2,$3,$4,$5)', [
        tenant,
        randomUUID(),
        submission,
        i === 0 ? 'invite' : 'decline',
        'Synthetic review',
      ])
      .then(
        () => 'saved',
        (e) => {
          if (e.message === 'SUBMISSION_CHANGED') return 'stale'
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
        'select count(*)::int n from seller_submission_reviews where submission_id=$1',
        [submission],
      )
    ).rows[0].n,
    1,
  )
  console.log(
    'PASS: conflicting submission reviews serialize to one immutable decision.',
  )
}
