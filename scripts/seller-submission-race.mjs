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

export async function raceSellerAI({ setup, sessions, tenant }) {
  const original = await Promise.all(
    sessions.map(
      async ({ c }) =>
        (
          await c.query(
            "select current_setting('request.jwt.claims') as claims",
          )
        ).rows[0].claims,
    ),
  )
  const actor = JSON.parse(original[0]).sub
  const email = (
    await setup.query('select email from auth.users where id=$1', [actor])
  ).rows[0].email
  const seller = randomUUID(),
    request = randomUUID(),
    path = `${tenant}/${seller}/${randomUUID()}.jpg`
  await sessions[0].c.query('select register_seller($1,$2,$3,$4,$5)', [
    tenant,
    seller,
    'AI race seller',
    email,
    '',
  ])
  await setup.query(
    "insert into storage.objects(bucket_id,name) values('seller-submission-photos',$1)",
    [path],
  )
  await setup.query(
    "insert into komisio_private.seller_ai_runtime values(true,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash",
  )
  try {
    for (const { c } of sessions) {
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        original[0],
      ])
      await c.query("select set_config('request.headers',$1,false)", [
        JSON.stringify({ 'x-komisio-seller-ai': 'a'.repeat(64) }),
      ])
    }
    await setup.query('begin')
    await setup.query('select id from tenants where id=$1 for update', [tenant])
    const runs = sessions.map(({ c }) =>
      c.query(
        'select begin_seller_photo_assistance($1,$2,$3,$4,$5) as result',
        [tenant, seller, request, JSON.stringify([path]), 'test-model'],
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
    assert.deepEqual(
      (await Promise.all(runs)).map((r) => r.rows[0].result.reserved).sort(),
      [false, true],
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_ai_attempts where id=$1',
          [request],
        )
      ).rows[0].n,
      1,
    )
    console.log('PASS: concurrent seller AI retries reserve one provider call.')
  } finally {
    for (let i = 0; i < sessions.length; i++) {
      await sessions[i].c.query(
        "select set_config('request.jwt.claims',$1,false)",
        [original[i]],
      )
      await sessions[i].c.query(
        "select set_config('request.headers','{}',false)",
      )
    }
  }
}
