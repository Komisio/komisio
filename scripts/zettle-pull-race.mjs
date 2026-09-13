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
      "update zettle_pull_connections set cutover=clock_timestamp()-interval '1 hour' where tenant_id=$1",
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
    console.log(
      'PASS: concurrent live window opens and page retries commit once.',
    )
  } finally {
    await a.end()
    await b.end()
  }
}
