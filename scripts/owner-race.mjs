import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
// Every run owns a separate disposable database. No tenant in the development database is touched.
const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const parsed = new URL(connectionString)
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  throw new Error('Concurrency test requires a local database')
const database = `komisio_race_${randomUUID().replaceAll('-', '')}`
if (!/^komisio_race_[a-f0-9]{32}$/.test(database))
  throw new Error('Invalid disposable database name')
const admin = new pg.Client({ connectionString })
await admin.connect()
const clients = []
try {
  await admin.query(`create database "${database}"`)
  parsed.pathname = `/${database}`
  const setup = new pg.Client({ connectionString: parsed.toString() })
  clients.push(setup)
  await setup.connect()
  await setup.query(`create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table auth.mfa_factors(user_id uuid,status text);
 create function auth.jwt() returns jsonb language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb,''{}''::jsonb)';
 create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
 grant usage on schema auth to authenticated;`)
  for (const file of (
    await readdir(new URL('../supabase/migrations/', import.meta.url))
  ).sort())
    await setup.query(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        'utf8',
      ),
    )
  const u1 = randomUUID(),
    u2 = randomUUID(),
    tenant = randomUUID()
  await setup.query(
    'insert into auth.users values($1,$2,now()),($3,$4,now())',
    [u1, 'a@example.test', u2, 'b@example.test'],
  )
  await setup.query(
    'insert into tenants(id,slug,name,created_by) values($1,$2,$3,$4)',
    [tenant, 'race', 'Race', u1],
  )
  await setup.query(
    "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
    [tenant, u2],
  )
  const sessions = await Promise.all(
    [u1, u2].map(async (uid, index) => {
      const c = new pg.Client({
        connectionString: parsed.toString(),
        application_name: `owner_race_${index}`,
      })
      clients.push(c)
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ])
      return { c, uid }
    }),
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(async ({ c, uid }) => {
    try {
      await c.query('begin')
      await c.query("select change_member($1,$2,'staff')", [tenant, uid])
      await c.query('commit')
      return 'changed'
    } catch (e) {
      await c.query('rollback')
      if (e.message.includes('last owner')) return 'blocked'
      throw e
    }
  })
  let waiting = 0
  for (let i = 0; i < 100; i++) {
    const { rows } = await setup.query(
      "select count(*)::int as waiting from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
    )
    waiting = rows[0].waiting
    if (waiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  const results = await Promise.all(attempts)
  const { rows } = await setup.query(
    "select count(*)::int as owners from tenant_members where tenant_id=$1 and role='owner'",
    [tenant],
  )
  if (
    waiting !== 2 ||
    results.filter((r) => r === 'changed').length !== 1 ||
    rows[0].owners !== 1
  )
    throw new Error(
      `Owner invariant failed: ${JSON.stringify({ waiting, results, owners: rows[0].owners })}`,
    )
  console.log(
    'PASS: two non-superuser sessions raced; one change succeeded, one was blocked, one owner remains.',
  )
  // Two browser retries by the same actor must resolve one custody event.
  const seller = randomUUID(),
    bag = randomUUID()
  for (const { c } of sessions) {
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: u1, role: 'authenticated' }),
    ])
  }
  await sessions[0].c.query(
    "select register_seller($1,$2,'Race seller','seller@example.test','')",
    [tenant, seller],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const receipts = sessions.map(({ c }) =>
    c.query("select receive_bag($1,$2,$3,'Concurrent bag') as id", [
      tenant,
      bag,
      seller,
    ]),
  )
  let receiptWaiting = 0
  for (let i = 0; i < 100; i++) {
    const result = await setup.query(
      "select count(*)::int as waiting from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
    )
    receiptWaiting = result.rows[0].waiting
    if (receiptWaiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  const receiptResults = await Promise.all(receipts)
  const evidence = await setup.query(
    "select (select count(*) from bag_receipts where id=$1)::int as bags, (select count(*) from access_events where target_id=$1 and action='bag.received')::int as events",
    [bag],
  )
  if (
    receiptWaiting !== 2 ||
    receiptResults.some((r) => r.rows[0].id !== bag) ||
    evidence.rows[0].bags !== 1 ||
    evidence.rows[0].events !== 1
  )
    throw new Error(
      'Concurrent receipt replay duplicated or lost custody evidence',
    )
  console.log(
    'PASS: two authenticated receipt requests raced; one bag and one audit event persisted.',
  )
  const ownerResult = await setup.query(
    "select user_id from tenant_members where tenant_id=$1 and role='owner'",
    [tenant],
  )
  const publishingActor = ownerResult.rows[0].user_id
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: publishingActor, role: 'authenticated' }),
    ])
  const agreement1 = randomUUID(),
    racingBag = randomUUID()
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const publish = sessions[0].c.query(
    "select publish_seller_agreement($1,$2,null,'Test','Fictional test','sv',true)",
    [tenant, agreement1],
  )
  const receiveDuringPublish = sessions[1].c
    .query(
      "select receive_bag_with_agreement($1,$2,$3,'Racing publication',null)",
      [tenant, racingBag, seller],
    )
    .then(
      () => 'received',
      (e) => {
        if (e.message.includes('AGREEMENT_CHANGED')) return 'changed'
        throw e
      },
    )
  let agreementWaiting = 0
  for (let i = 0; i < 100; i++) {
    const result = await setup.query(
      "select count(*)::int as waiting from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
    )
    agreementWaiting = result.rows[0].waiting
    if (agreementWaiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  await publish
  const receivingOutcome = await receiveDuringPublish
  const racingEvidence = await setup.query(
    'select agreement_version_id from bag_receipts where id=$1',
    [racingBag],
  )
  if (
    agreementWaiting !== 2 ||
    (receivingOutcome === 'changed' && racingEvidence.rowCount !== 0) ||
    (receivingOutcome === 'received' &&
      (racingEvidence.rowCount !== 1 ||
        racingEvidence.rows[0].agreement_version_id !== null))
  )
    throw new Error(
      'Receipt crossed an inconsistent agreement publication boundary',
    )
  const publicationResults = await Promise.all(
    sessions.map(({ c }) =>
      c
        .query(
          "select publish_seller_agreement($1,$2,$3,'Next','Fictional next','en',false)",
          [tenant, randomUUID(), agreement1],
        )
        .then(
          () => 'published',
          (e) => {
            if (e.message.includes('AGREEMENT_CHANGED')) return 'changed'
            throw e
          },
        ),
    ),
  )
  const versions = await setup.query(
    'select count(*)::int as count from seller_agreement_versions where tenant_id=$1',
    [tenant],
  )
  if (
    publicationResults.filter((r) => r === 'published').length !== 1 ||
    versions.rows[0].count !== 2
  )
    throw new Error('Concurrent publications overwrote an unreviewed version')
  console.log(
    'PASS: publication and receipt serialize; concurrent publishers cannot silently replace each other.',
  )
  const inspectionDraft = randomUUID()
  const raceInspection = await Promise.all(
    sessions.map(({ c }) =>
      c
        .query(
          "select save_inspection_draft($1,$2,$3,$4,0,'Test jacket','','') as id",
          [tenant, randomUUID(), bag, inspectionDraft],
        )
        .then(
          () => 'saved',
          (e) => {
            if (e.message.includes('INSPECTION_DRAFT_CHANGED')) return 'stale'
            throw e
          },
        ),
    ),
  )
  if (
    raceInspection.filter((r) => r === 'saved').length !== 1 ||
    raceInspection.filter((r) => r === 'stale').length !== 1
  )
    throw new Error('Concurrent inspection edits did not reject stale revision')
  const replayId = randomUUID()
  const replayInspection = await Promise.all(
    sessions.map(({ c }) =>
      c.query(
        "select save_inspection_draft($1,$2,$3,$4,1,'Updated jacket','Clothes','') as id",
        [tenant, replayId, bag, inspectionDraft],
      ),
    ),
  )
  const revisions = await setup.query(
    'select count(*)::int as count from inspection_draft_revisions where draft_id=$1',
    [inspectionDraft],
  )
  if (
    replayInspection.some((r) => r.rows[0].id !== replayId) ||
    revisions.rows[0].count !== 2
  )
    throw new Error('Concurrent inspection retry duplicated revision')
  console.log(
    'PASS: concurrent inspection edits reject stale revisions; identical retries persist once.',
  )
} finally {
  await Promise.allSettled(clients.map((c) => c.end()))
  await admin.query(`drop database if exists "${database}"`)
  await admin.end()
}
