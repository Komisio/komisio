import { raceStoreCreation } from './store-creation-race.mjs'
import { raceSellerProfile } from './seller-profile-race.mjs'
import { raceZettleStock } from './zettle-stock-race.mjs'
import { raceFortnoxSend } from './fortnox-send-race.mjs'
import { raceZettleImage } from './zettle-image-race.mjs'
import { raceZettlePull } from './zettle-pull-race.mjs'
import { raceSellerPayout } from './seller-payout-race.mjs'
import { raceStorePolicy } from './store-policy-race.mjs'
import { raceStoreGuide } from './store-guide-race.mjs'
import { racePayPalCredentials } from './paypal-credentials-race.mjs'
import { raceLabelPrintRule } from './label-print-rule-race.mjs'
import { raceInspectionApproval } from './inspection-operation-race.mjs'
import { raceAcceptance, raceStagedAcceptance } from './acceptance-race.mjs'
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
  await setup.query(`create schema extensions;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table auth.mfa_factors(user_id uuid,status text);
 create function auth.jwt() returns jsonb language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb,''{}''::jsonb)';
 create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
 grant usage on schema auth to authenticated;
 -- Minimal Storage metadata contract for engine concurrency tests; real Storage is tested separately.
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,anon;
 grant select,insert,update,delete on storage.objects to authenticated;
 grant select on storage.buckets to authenticated;`)
  for (const file of (
    await readdir(new URL('../supabase/migrations/', import.meta.url))
  ).sort())
    await setup.query(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        'utf8',
      ),
    )
  await raceZettleStock({ setup, connectionString: parsed.toString() })
  await raceZettleImage({ setup, connectionString: parsed.toString() })
  await raceZettlePull({ setup, connectionString: parsed.toString() })
  await raceFortnoxSend({ setup, connectionString: parsed.toString() })
  await raceFortnoxSend({
    setup,
    connectionString: parsed.toString(),
    automation: true,
  })
  await raceSellerPayout({ setup, connectionString: parsed.toString() })
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
  await raceStoreCreation({ setup, sessions })
  await raceStorePolicy({ setup, sessions, tenant })
  await raceStoreGuide({ setup, sessions, tenant })
  await racePayPalCredentials({ setup, sessions, tenant })
  await raceSellerProfile({ setup, sessions, tenant })
  await raceLabelPrintRule({ setup, sessions, tenant })
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

  const raceStatus = await Promise.all(
    [
      sessions[0].c.query(
        "select set_inspection_archived($1,$2,$3,$4,2,true,'Duplicate draft')",
        [tenant, randomUUID(), bag, inspectionDraft],
      ),
      sessions[1].c.query(
        "select save_inspection_draft($1,$2,$3,$4,2,'Competing description','','')",
        [tenant, randomUUID(), bag, inspectionDraft],
      ),
    ].map((p) =>
      p.then(
        () => 'saved',
        (e) => {
          if (e.message.includes('INSPECTION_DRAFT_CHANGED')) return 'stale'
          throw e
        },
      ),
    ),
  )
  if (
    raceStatus.filter((r) => r === 'saved').length !== 1 ||
    raceStatus.filter((r) => r === 'stale').length !== 1
  )
    throw new Error('Status/edit race did not reject stale operation')
  const currentStatus = (
    await setup.query(
      'select archived,revision from inspection_current where draft_id=$1',
      [inspectionDraft],
    )
  ).rows[0]
  const statusRequest = randomUUID()
  const statusRetries = await Promise.all(
    sessions.map(({ c }) =>
      c.query(
        "select set_inspection_archived($1,$2,$3,$4,$5,$6,'Concurrent status retry') as id",
        [
          tenant,
          statusRequest,
          bag,
          inspectionDraft,
          currentStatus.revision,
          !currentStatus.archived,
        ],
      ),
    ),
  )
  const statusCount = (
    await setup.query(
      'select count(*)::int as count from inspection_draft_revisions where draft_id=$1',
      [inspectionDraft],
    )
  ).rows[0].count
  if (
    statusCount !== 4 ||
    statusRetries.some((r) => r.rows[0].id !== statusRequest)
  )
    throw new Error('Status retry duplicated revisions')
  console.log(
    'PASS: archive/edit race rejects stale operations; concurrent status retries persist once.',
  )

  const receptionId = randomUUID()
  await sessions[0].c.query('select create_reception_session($1,$2,$3)', [
    tenant,
    receptionId,
    seller,
  ])
  const receptionSources = JSON.stringify([
    {
      id: randomUUID(),
      kind: 'observation',
      reference: 'Synthetic race',
      observation: 'Blue jacket',
    },
  ])
  const raceSources = await Promise.all(
    sessions.map(({ c }) =>
      c
        .query('select save_reception_sources($1,$2,$3,0,$4::jsonb)', [
          tenant,
          randomUUID(),
          receptionId,
          receptionSources,
        ])
        .then(
          () => 'saved',
          (e) => {
            if (e.message.includes('RECEPTION_CHANGED')) return 'stale'
            throw e
          },
        ),
    ),
  )
  if (
    raceSources.filter((r) => r === 'saved').length !== 1 ||
    raceSources.filter((r) => r === 'stale').length !== 1
  )
    throw new Error('Reception race did not reject stale snapshot')
  const receptionRequest = randomUUID()
  const receptionRetry = await Promise.all(
    sessions.map(({ c }) =>
      c.query('select save_reception_sources($1,$2,$3,1,$4::jsonb) as id', [
        tenant,
        receptionRequest,
        receptionId,
        receptionSources,
      ]),
    ),
  )
  const receptionCount = (
    await setup.query(
      'select count(*)::int as count from reception_source_revisions where session_id=$1',
      [receptionId],
    )
  ).rows[0].count
  if (
    receptionCount !== 2 ||
    receptionRetry.some((r) => r.rows[0].id !== receptionRequest)
  )
    throw new Error('Reception replay duplicated history')
  console.log(
    'PASS: concurrent reception snapshots reject stale writes; identical retries persist once.',
  )

  const reviewSources = [
    {
      id: randomUUID(),
      kind: 'price-evidence',
      reference: 'TEST appraisal',
      observation: 'Fictional price',
    },
  ]
  await sessions[0].c.query(
    'select save_reception_sources($1,$2,$3,2,$4::jsonb)',
    [tenant, randomUUID(), receptionId, JSON.stringify(reviewSources)],
  )
  const reviewTerms = (
    await setup.query(
      'select id from seller_agreement_versions where tenant_id=$1 order by version desc limit 1',
      [tenant],
    )
  ).rows[0].id
  const suggestions = JSON.stringify({
    attributes: [
      {
        slug: 'description',
        definitionVersion: 1,
        value: 'TEST garment',
        sourceIds: [reviewSources[0].id],
        certainty: 'observed',
      },
    ],
    price: {
      currency: 'SEK',
      amount: '250.00',
      rationale: 'TEST only',
      sourceIds: [reviewSources[0].id],
    },
    questions: [],
  })
  const expiry = new Date(Date.now() + 3600000).toISOString()
  const reviewRace = await Promise.all(
    sessions.map(({ c }) =>
      c
        .query(
          'select publish_reception_review($1,$2,$3,3,null,$4,$5::jsonb,$6)',
          [tenant, randomUUID(), receptionId, reviewTerms, suggestions, expiry],
        )
        .then(
          () => 'published',
          (e) => {
            if (e.message.includes('RECEPTION_REVIEW_CHANGED')) return 'stale'
            throw e
          },
        ),
    ),
  )
  if (
    reviewRace.filter((r) => r === 'published').length !== 1 ||
    reviewRace.filter((r) => r === 'stale').length !== 1
  )
    throw new Error('Review publishers overwrote unreviewed state')
  const previousReview = (
    await setup.query(
      'select id from reception_reviews_current where session_id=$1',
      [receptionId],
    )
  ).rows[0].id
  const reviewRequest = randomUUID()
  const reviewRetries = await Promise.all(
    sessions.map(({ c }) =>
      c.query(
        'select publish_reception_review($1,$2,$3,3,$4,$5,$6::jsonb,$7) as id',
        [
          tenant,
          reviewRequest,
          receptionId,
          previousReview,
          reviewTerms,
          suggestions,
          expiry,
        ],
      ),
    ),
  )
  const reviewCount = (
    await setup.query(
      'select count(*)::int as count from reception_reviews where session_id=$1',
      [receptionId],
    )
  ).rows[0].count
  if (
    reviewCount !== 2 ||
    reviewRetries.some((r) => r.rows[0].id !== reviewRequest)
  )
    throw new Error('Review retries duplicated snapshot')
  console.log(
    'PASS: concurrent review publication requires expected previous review; retries persist once.',
  )
  const aiRequest = randomUUID()
  const aiRace = await Promise.all(
    sessions.map(({ c }) =>
      c.query(
        "select reserve_reception_assistance($1,$2,$3,3,'fixture-model','reception-v1') as reserved",
        [tenant, aiRequest, receptionId],
      ),
    ),
  )
  if (aiRace.filter((r) => r.rows[0].reserved).length !== 1)
    throw new Error('Assistance retry reserved more than once')
  const aiLimitRace = await Promise.all(
    sessions.map(({ c }) =>
      c
        .query(
          "select reserve_reception_assistance($1,$2,$3,3,'fixture-model','reception-v1')",
          [tenant, randomUUID(), receptionId],
        )
        .then(
          () => false,
          (e) => {
            if (e.message === 'ASSISTANCE_LIMIT') return true
            throw e
          },
        ),
    ),
  )
  if (!aiLimitRace.every(Boolean))
    throw new Error('Concurrent assistance bypassed cooldown')
  console.log(
    'PASS: assistance request replay reserves once; concurrent new attempts respect tenant cooldown.',
  )
  const sellerUser = randomUUID(),
    accessRequest = randomUUID()
  await setup.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'seller@example.test',now())",
    [sellerUser],
  )
  await sessions[0].c.query(
    "select set_reception_access($1,$2,$3,null,encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'))",
    [tenant, accessRequest, reviewRequest],
  )
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: sellerUser, role: 'authenticated' }),
    ])
  const decisionRace = await Promise.all(
    sessions.map(({ c }, i) =>
      c
        .query("select respond_to_reception_review(repeat('c',64),$1,$2,$3)", [
          randomUUID(),
          reviewRequest,
          i === 0 ? 'approve' : 'decline',
        ])
        .then(
          () => 'saved',
          (e) => {
            if (e.message.includes('REVIEW_ALREADY_ANSWERED')) return 'answered'
            throw e
          },
        ),
    ),
  )
  if (
    decisionRace.filter((r) => r === 'saved').length !== 1 ||
    decisionRace.filter((r) => r === 'answered').length !== 1
  )
    throw new Error('Conflicting seller decisions both persisted')
  const response = (
    await setup.query(
      'select id,decision from reception_responses where review_id=$1',
      [reviewRequest],
    )
  ).rows[0]
  const responseRetries = await Promise.all(
    sessions.map(({ c }) =>
      c.query(
        "select respond_to_reception_review(repeat('c',64),$1,$2,$3) as id",
        [response.id, reviewRequest, response.decision],
      ),
    ),
  )
  if (responseRetries.some((r) => r.rows[0].id !== response.id))
    throw new Error('Seller decision retry did not resolve original')
  console.log(
    'PASS: concurrent seller approval/decline persists once; same-actor retries return original response.',
  )
  // Two staff approve one agent proposal concurrently; exactly one execution.
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: publishingActor, role: 'authenticated' }),
    ])
  const proposalId = randomUUID()
  await sessions[0].c.query(
    "select propose_operation($1,$2,'publishReceptionReview',$3::jsonb,'race-agent',now()+interval '1 day')",
    [
      tenant,
      proposalId,
      JSON.stringify({
        sessionId: receptionId,
        sourceRevision: 3,
        previousReviewId: reviewRequest,
        agreementId: reviewTerms,
        expiresAt: expiry,
        suggestions: JSON.parse(suggestions),
      }),
    ],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const approvals = sessions.map(({ c }) =>
    c
      .query("select decide_operation($1,$2,$3,'approved','')", [
        tenant,
        randomUUID(),
        proposalId,
      ])
      .then(
        () => 'decided',
        (e) => {
          if (e.message.includes('OPERATION_DECIDED')) return 'already'
          throw e
        },
      ),
  )
  let approvalWaiting = 0
  for (let i = 0; i < 100; i++) {
    const result = await setup.query(
      "select count(*)::int as waiting from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
    )
    approvalWaiting = result.rows[0].waiting
    if (approvalWaiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  const approvalResults = await Promise.all(approvals)
  const decisionState = await setup.query(
    'select (select count(*) from operation_decisions where operation_id=$1)::int decisions,(select outcome from operation_decisions where operation_id=$1) outcome,(select count(*) from reception_reviews where session_id=$2)::int reviews',
    [proposalId, receptionId],
  )
  if (
    approvalWaiting !== 2 ||
    approvalResults.filter((r) => r === 'decided').length !== 1 ||
    approvalResults.filter((r) => r === 'already').length !== 1 ||
    decisionState.rows[0].decisions !== 1 ||
    decisionState.rows[0].outcome !== 'executed' ||
    decisionState.rows[0].reviews !== 3
  )
    throw new Error(
      `Concurrent approvals executed a proposal more than once: ${JSON.stringify({ approvalWaiting, approvalResults, state: decisionState.rows[0] })}`,
    )
  const decisionId = (
    await setup.query(
      'select id from operation_decisions where operation_id=$1',
      [proposalId],
    )
  ).rows[0].id
  const decisionRetries = await Promise.all(
    sessions.map(({ c }) =>
      c.query("select decide_operation($1,$2,$3,'approved','') as id", [
        tenant,
        decisionId,
        proposalId,
      ]),
    ),
  )
  if (decisionRetries.some((r) => r.rows[0].id !== decisionId))
    throw new Error('Decision retry did not resolve the original decision')
  console.log(
    'PASS: concurrent approvals of one staged proposal execute once; identical decision retries resolve the original.',
  )
  await raceInspectionApproval({ setup, sessions, tenant, bag })
  await raceAcceptance({ setup, sessions, tenant, actor: publishingActor })
  await raceStagedAcceptance({
    setup,
    sessions,
    tenant,
    // The owner race decides who stays owner; the other member proposes so the approver differs.
    proposer: [u1, u2].find((u) => u !== publishingActor),
    approver: publishingActor,
  })
  // A seller read must not wait for the tenant lock; the seller response must.
  await sessions[0].c.query(
    "select set_reception_access($1,$2,$3,null,encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex'))",
    [tenant, randomUUID(), proposalId],
  )
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: sellerUser, role: 'authenticated' }),
    ])
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const readWhileLocked = await Promise.race([
    sessions[0].c
      .query("select read_seller_review(repeat('e',64)) as review")
      .then((r) =>
        r.rows[0].review.reviewId === proposalId ? 'read' : 'wrong',
      ),
    pause(3000).then(() => 'blocked'),
  ])
  const respondWhileLocked = sessions[1].c
    .query(
      "select respond_to_reception_review(repeat('e',64),$1,$2,'approve')",
      [randomUUID(), proposalId],
    )
    .then(() => 'responded')
  let responseWaiting = 0
  for (let i = 0; i < 100; i++) {
    const result = await setup.query(
      "select count(*)::int as waiting from pg_stat_activity where application_name='owner_race_1' and wait_event_type='Lock'",
    )
    responseWaiting = result.rows[0].waiting
    if (responseWaiting === 1) break
    await pause(20)
  }
  await setup.query('commit')
  const responseOutcome = await respondWhileLocked
  if (
    readWhileLocked !== 'read' ||
    responseWaiting !== 1 ||
    responseOutcome !== 'responded'
  )
    throw new Error(
      `Seller read locking regressed: ${JSON.stringify({ readWhileLocked, responseWaiting, responseOutcome })}`,
    )
  console.log(
    'PASS: a seller read completes while staff hold the tenant lock; the seller response waits for it.',
  )
} finally {
  await Promise.allSettled(clients.map((c) => c.end()))
  await admin.query(`drop database if exists "${database}"`)
  await admin.end()
}
