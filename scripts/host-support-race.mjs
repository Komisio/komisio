import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import pg from 'pg'

export async function raceHostSupport({ setup, connectionString }) {
  const user = randomUUID(),
    session = randomUUID(),
    tenant = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [user, `support-race-${user}@example.test`],
  )
  await setup.query(
    "insert into platform_hosts(user_id,kind) values($1,'person')",
    [user],
  )
  await setup.query('insert into auth.sessions(id,user_id) values($1,$2)', [
    session,
    user,
  ])
  await setup.query(
    'insert into tenants(id,slug,name,created_by) values($1,$2,$3,$4)',
    [tenant, `support-${tenant}`, 'Support race fixture', user],
  )
  const clients = [0, 1].map(
    (i) =>
      new pg.Client({
        connectionString,
        application_name: `support_race_${i}`,
      }),
  )
  for (const client of clients) {
    await client.connect()
    await client.query('set role authenticated')
    await client.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: user, session_id: session, role: 'authenticated' }),
    ])
  }
  const [a, b] = clients
  async function waiting() {
    for (let i = 0; i < 100; i++) {
      const { rows } = await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name='support_race_1' and wait_event_type='Lock'",
      )
      if (rows[0].n === 1) return
      await pause(20)
    }
    assert.fail('Expected the second connection to wait on the support lock')
  }
  const start = (client, id) =>
    client.query('select start_host_support($1,$2,$3)', [
      id,
      tenant,
      'Concurrency fixture',
    ])
  try {
    // A committed start must stop a write that was waiting behind it, including
    // writes that bypass tenant-role checks. Catch immediately to avoid an
    // unhandled rejected promise while the other connection is held.
    const first = randomUUID()
    await a.query('begin')
    await start(a, first)
    const pendingWrite = b.query("select save_profile('Forbidden','en')").then(
      () => null,
      (error) => error.message,
    )
    await waiting()
    await a.query('commit')
    assert.equal(await pendingWrite, 'SUPPORT_READ_ONLY')
    await a.query('select end_host_support($1)', [first])

    // Concurrent starts cannot silently switch stores or create overlapping visits.
    const second = randomUUID()
    await a.query('begin')
    await start(a, second)
    const pendingStart = start(b, randomUUID()).then(
      () => null,
      (error) => error.message,
    )
    await waiting()
    await a.query('commit')
    assert.equal(await pendingStart, 'SUPPORT_ACTIVE')
    await a.query('select end_host_support($1)', [second])

    // A write already in flight completes before start is allowed to return.
    await a.query('begin')
    await a.query("select save_profile('Before support','en')")
    const third = randomUUID()
    const afterWrite = start(b, third)
    await waiting()
    await a.query('commit')
    await afterWrite
    // A delayed exit retry from the previous visit cannot close this new one.
    await a.query('select end_host_support($1)', [second])
    assert.equal(
      (await b.query('select host_support_context() state')).rows[0].state.id,
      third,
    )
    await b.query('select end_host_support($1)', [third])
    console.log(
      'PASS: support starts serialize with writes and other starts; stale exit retries preserve the current visit.',
    )
  } finally {
    for (const client of clients) {
      await client.query('rollback')
      await client.end()
    }
  }
}
