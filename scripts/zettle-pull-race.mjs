import pg from 'pg'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
export async function raceZettlePull({ setup, connectionString }) {
  const actor = randomUUID(),
    merchant = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `pull-${actor}@example.test`],
  )
  const connect = async () => {
    const c = new pg.Client({ connectionString })
    await c.connect()
    await c.query('set role authenticated')
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
    return c
  }
  const a = await connect(),
    b = await connect()
  try {
    const tenant = (
      await a.query('select create_tenant($1,$2,$3) id', [
        'Pull race',
        `pull-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    await a.query('select enable_zettle_pull($1,$2)', [tenant, merchant])
    // Disposable local database only: age the connection to avoid wall-clock sleeps.
    await setup.query(
      'alter table zettle_pull_connections disable trigger zettle_pull_immutable',
    )
    await setup.query(
      "update zettle_pull_connections set cutover=clock_timestamp()-interval '3 days' where tenant_id=$1",
      [tenant],
    )
    await setup.query(
      'alter table zettle_pull_connections enable trigger zettle_pull_immutable',
    )
    const opened = await Promise.all(
      [a, b].map((c) =>
        c.query('select open_zettle_pull_window($1,$2) id', [tenant, merchant]),
      ),
    )
    assert.equal(opened[0].rows[0].id, opened[1].rows[0].id)
    const window = opened[0].rows[0].id,
      id = randomUUID()
    const result = await Promise.all(
      [a, b].map((c) =>
        c.query("select record_zettle_pull_page($1,$2,$3,null,null,'[]') id", [
          tenant,
          id,
          window,
        ]),
      ),
    )
    assert.equal(result[0].rows[0].id, id)
    assert.equal(result[1].rows[0].id, id)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from zettle_pull_pages where window_id=$1',
          [window],
        )
      ).rows[0].n,
      1,
    )
    const nextWindow = (
      await a.query('select open_zettle_pull_window($1,$2) id', [
        tenant,
        merchant,
      ])
    ).rows[0].id
    const closeId = randomUUID()
    const competing = await Promise.allSettled([
      a.query('select abandon_zettle_pull_window($1,$2,$3,$4)', [
        tenant,
        closeId,
        nextWindow,
        'Synthetic stuck page',
      ]),
      b.query("select record_zettle_pull_page($1,$2,$3,null,null,'[]')", [
        tenant,
        randomUUID(),
        nextWindow,
      ]),
    ])
    assert.equal(
      competing.filter((entry) => entry.status === 'fulfilled').length,
      1,
    )
    const rejected = competing.find((entry) => entry.status === 'rejected')
    assert.match(rejected.reason.message, /ZETTLE_WINDOW_(ABANDONED|COMPLETE)/)
    const closures = (
      await setup.query(
        'select count(*)::int n from zettle_pull_window_closures where window_id=$1',
        [nextWindow],
      )
    ).rows[0].n
    const pages = (
      await setup.query(
        'select count(*)::int n from zettle_pull_pages where window_id=$1',
        [nextWindow],
      )
    ).rows[0].n
    assert.equal(closures + pages, 1)
    const worker = randomUUID()
    const workerEmail = `automation-${worker}@example.test`
    await setup.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [worker, workerEmail],
    )
    await a.query("select enable_automation($1,$2,'zettle_pull',$3)", [
      tenant,
      randomUUID(),
      workerEmail,
    ])
    for (const session of [a, b]) {
      await session.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: worker, role: 'authenticated' }),
      ])
    }
    await a.query('select accept_automation_grants()')
    const prepared = await Promise.all(
      [a, b].map((session) =>
        session.query('select prepare_zettle_automatic_pull($1,$2) job', [
          tenant,
          merchant,
        ]),
      ),
    )
    const jobs = prepared.map((result) => result.rows[0].job).filter(Boolean)
    assert.equal(jobs.length, 1)
    await b.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
    await b.query("select disable_automation($1,'zettle_pull')", [tenant])
    await assert.rejects(
      a.query("select record_zettle_pull_page($1,$2,$3,null,null,'[]')", [
        tenant,
        jobs[0].id,
        jobs[0].windowId,
      ]),
      /FORBIDDEN/,
    )
    console.log(
      'PASS: duplicate cron reservations serialize; revocation blocks an in-flight page.',
    )
    console.log(
      'PASS: window abandonment and page completion serialize without partial writes.',
    )
    console.log(
      'PASS: concurrent live window opens and page retries commit once.',
    )
  } finally {
    await a.end()
    await b.end()
  }
}
