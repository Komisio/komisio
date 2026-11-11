// Local, synthetic multi-connection proof: a delivery yields one send claim.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { Client } = createRequire(import.meta.url)('pg')
const connectionString = process.env.TEST_DATABASE_URL
if (
  !connectionString ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
)
  throw new Error('A loopback TEST_DATABASE_URL is required')
const connections = Array.from(
  { length: 3 },
  () => new Client({ connectionString }),
)
const [setup, first, second] = connections
try {
  await Promise.all(connections.map((c) => c.connect()))
  const worker = randomUUID()
  let fixture = readFileSync(
    new URL('../supabase/tests/0462_seller_push.test.sql', import.meta.url),
    'utf8',
  )
  const claimStart = fixture.indexOf("select set_config('test.first_claim'")
  assert(claimStart > 0, 'Fixture must stop before its first send claim')
  fixture = fixture
    .slice(0, claimStart)
    .replace(/\\ir bag-reception-fixture.inc/, () =>
      readFileSync(
        new URL('../supabase/tests/bag-reception-fixture.inc', import.meta.url),
        'utf8',
      ),
    )
    .replaceAll('f0000000-0000-4000-8000-000000000764', worker)
    .replaceAll('push-fixture', `push-${randomUUID()}`)
  for (const suffix of ['761', '762', '763', '765'])
    fixture = fixture.replaceAll(
      `f0000000-0000-4000-8000-000000000${suffix}`,
      randomUUID(),
    )
  fixture = fixture
    .replaceAll('@example.test', `-${randomUUID()}@example.test`)
    .replaceAll('synthetic_push_device', randomUUID())
  const results = await setup.query(fixture)
  for (const result of results)
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
      JSON.stringify({ sub: worker, role: 'authenticated', aal: 'aal1' }),
    ])
  }
  const claim =
    "select claim_seller_push($1,'sv','Synthetic title','Synthetic body') result"
  const a = await first.query(claim, [id])
  // Start the competing request while the first still owns its row locks.
  const bPromise = second.query(claim, [id])
  await first.query('commit')
  const b = await bPromise
  await second.query('commit')
  assert.equal([a, b].filter((r) => r.rows[0].result !== null).length, 1)
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from public.seller_communications where id=$1',
        [id],
      )
    ).rows[0].n,
    1,
  )
  console.log(
    'PASS: two database connections produced exactly one send claim and one communication record.',
  )
} finally {
  await Promise.allSettled(connections.map((c) => c.end()))
}
