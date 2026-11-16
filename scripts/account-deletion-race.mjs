import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import pg from 'pg'

export async function raceAccountDeletion({ setup, connectionString }) {
  const user = randomUUID(),
    session = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [user, `deletion-race-${user}@example.test`],
  )
  await setup.query(
    "insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",
    [session, user],
  )
  await setup.query(
    "insert into platform_hosts(user_id,kind) values($1,'person')",
    [user],
  )
  const clients = [0, 1].map(
    (i) =>
      new pg.Client({
        connectionString,
        application_name: `deletion_race_${i}`,
      }),
  )
  const [a, b] = clients
  async function waiting() {
    for (let i = 0; i < 150; i++) {
      const result = await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name='deletion_race_1' and wait_event_type='Lock'",
      )
      if (result.rows[0].n === 1) return
      await pause(20)
    }
    assert.fail('Expected the competing deletion command to wait')
  }
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: user,
          session_id: session,
          role: 'authenticated',
          aal: 'aal1',
        }),
      ])
    }
    const request = randomUUID()
    await a.query('begin')
    await a.query("select request_account_deletion($1,'en',true)", [request])
    const second = b.query(
      "select request_account_deletion($1,'sv',true) value",
      [randomUUID()],
    )
    await waiting()
    await a.query('commit')
    assert.equal((await second).rows[0].value.id, request)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from account_deletion_requests where user_id=$1',
          [user],
        )
      ).rows[0].n,
      1,
    )
    const event = randomUUID()
    await a.query('begin')
    await a.query(
      "select handle_account_deletion($1,$2,null,'processing','{}')",
      [event, request],
    )
    const competing = b
      .query("select handle_account_deletion($1,$2,null,'processing','{}')", [
        randomUUID(),
        request,
      ])
      .then(
        () => 'unexpected',
        (e) => e.message,
      )
    await waiting()
    await a.query('commit')
    assert.equal(await competing, 'REQUEST_CHANGED')
    assert.equal(
      (
        await b.query(
          "select handle_account_deletion($1,$2,null,'processing','{}') value",
          [event, request],
        )
      ).rows[0].value.status,
      'processing',
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from account_deletion_events where request_id=$1',
          [request],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query('select deleted_at from auth.users where id=$1', [
          user,
        ])
      ).rows[0].deleted_at,
      null,
    )
  } finally {
    for (const c of clients) {
      await c.query('rollback').catch(() => {})
      await c.end()
    }
  }
}
