import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const connectionString = process.env.TEST_DATABASE_URL
if (
  !connectionString ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
)
  throw new Error('A loopback TEST_DATABASE_URL is required')
const clients = Array.from(
  { length: 3 },
  () => new pg.Client({ connectionString }),
)
const [setup, first, second] = clients
let previous
try {
  await Promise.all(clients.map((c) => c.connect()))
  previous = (
    await setup.query(
      'select central_app_tenant_id from platform_settings where only_row',
    )
  ).rows[0].central_app_tenant_id
  let fixture = readFileSync(
    new URL(
      '../supabase/tests/0475_external_request_push.test.sql',
      import.meta.url,
    ),
    'utf8',
  )
  fixture = fixture.slice(0, fixture.indexOf('select is(claim_seller_push'))
  const ids = new Map(
    [...new Set(fixture.match(/f7500000-0000-4000-8000-\d{12}/g))].map((id) => [
      id,
      randomUUID(),
    ]),
  )
  const worker = ids.get('f7500000-0000-4000-8000-000000000004')
  fixture = fixture
    .replace(/f7500000-0000-4000-8000-\d{12}/g, (id) => ids.get(id))
    .replaceAll('@example.test', `-${randomUUID()}@example.test`)
    .replaceAll('synthetic-request-push', `push-${randomUUID()}`)
    .replaceAll('synthetic_external', randomUUID())
    .replaceAll('46700007502', `467${Date.now()}2`)
    .replaceAll('46700007503', `467${Date.now()}3`)
  for (const result of await setup.query(fixture))
    for (const row of result.rows)
      for (const value of Object.values(row))
        assert.doesNotMatch(String(value), /^not ok/m)
  const id = (await setup.query("select current_setting('test.delivery') id"))
    .rows[0].id
  await setup.query('commit')
  for (const client of [first, second]) {
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: worker, role: 'authenticated' }),
    ])
  }
  const command =
    "select claim_seller_push($1,'sv','Synthetic offer','Open app') result"
  const a = await first.query(command, [id])
  const waiting = second.query(command, [id])
  await first.query('commit')
  const b = await waiting
  await second.query('commit')
  assert.equal([a, b].filter((r) => r.rows[0].result !== null).length, 1)
  assert.equal(a.rows[0].result.kind, 'external_item_offered')
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from seller_communications where id=$1',
        [id],
      )
    ).rows[0].n,
    0,
  )
  console.log(
    'PASS: competing workers obtained one external-offer send claim, with no seller or membership creation.',
  )
} finally {
  await Promise.allSettled(clients.map((c) => c.query('rollback')))
  if (previous !== undefined)
    await setup.query(
      'update platform_settings set central_app_tenant_id=$1 where only_row',
      [previous],
    )
  await Promise.allSettled(clients.map((c) => c.end()))
}
