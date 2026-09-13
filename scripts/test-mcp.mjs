import { testSellerEconomyMCP } from './test-seller-economy-mcp.mjs'
import { testOperationDiscovery } from './test-operation-discovery.mjs'
import { testInspectionMCP } from './test-inspection-mcp.mjs'
import { testItemsMCP } from './test-items-mcp.mjs'
import { Client as MCPClient } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createClient } from '@supabase/supabase-js'
import { randomUUID, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import pg from 'pg'
import sharp from 'sharp'
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (url !== 'http://127.0.0.1:54321' || !key)
  throw new Error('MCP integration test requires configured local Supabase')
const db = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
const app = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const email = `mcp-${randomUUID()}@example.test`,
  password = `M!${randomBytes(20).toString('hex')}`,
  clients = []
await db.connect()
try {
  const signed = await app.auth.signUp({ email, password })
  if (signed.error) throw new Error('Local MCP signup failed')
  const uid = signed.data.user.id
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [
    uid,
  ])
  const login = await app.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error('Local MCP login failed')
  const token = login.data.session.access_token
  async function rpc(name, args) {
    const r = await app.rpc(name, args)
    if (r.error) throw new Error(`Fixture operation failed: ${name}`)
    return r.data
  }
  const tenant = await rpc('create_tenant', {
    p_name: 'MCP fixture',
    p_slug: `mcp-${randomUUID()}`,
    p_request_id: randomUUID(),
  })
  const seller = await rpc('register_seller', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_name: 'MCP test seller',
    p_email: 'mcp-seller@example.test',
    p_phone: '',
  })
  const session = randomUUID(),
    source = randomUUID(),
    price = randomUUID()
  await rpc('create_reception_session', {
    p_tenant: tenant,
    p_id: session,
    p_seller: seller,
  })
  const photoId = randomUUID(),
    photoPath = `${tenant}/${session}/${photoId}.jpg`
  const original = await sharp({
    create: { width: 40, height: 60, channels: 3, background: '#25547e' },
  })
    .withExif({ IFD0: { Artist: 'PRIVATE MCP FIXTURE' } })
    .jpeg()
    .toBuffer()
  const uploaded = await app.storage
    .from('reception-photos')
    .upload(photoPath, original, { contentType: 'image/jpeg', upsert: false })
  assert.ifError(uploaded.error)
  await rpc('save_reception_sources', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: session,
    p_expected: 0,
    p_sources: [
      { id: photoId, kind: 'photo', reference: photoPath, observation: '' },
      {
        id: source,
        kind: 'observation',
        reference: 'MCP fixture',
        observation: 'Synthetic blue jacket',
      },
      {
        id: price,
        kind: 'price-evidence',
        reference: 'MCP fixture appraisal',
        observation: 'Fictional 250 SEK',
      },
    ],
  })
  async function connect(scopes, access = token, store = tenant) {
    const client = new MCPClient({ name: 'komisio-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'mcp/stdio.ts'],
      cwd: process.cwd(),
      env: {
        KOMISIO_MCP_SUPABASE_URL: url,
        KOMISIO_MCP_PUBLISHABLE_KEY: key,
        KOMISIO_MCP_ACCESS_TOKEN: access,
        KOMISIO_MCP_TENANT_ID: store,
        KOMISIO_MCP_SCOPES: scopes,
      },
      stderr: 'pipe',
      maxBufferSize: 2097152,
    })
    clients.push(client)
    await client.connect(transport)
    return client
  }
  await testSellerEconomyMCP({ connect, rpc, db, uid })
  const both = await connect('reception:read,reception:preview')
  const inspection = await testInspectionMCP({
    connect,
    rpc,
    db,
    tenant,
    seller,
    token,
    receptionClient: both,
  })
  await testItemsMCP({ connect, rpc, db, tenant, token, uid })
  const catalog = await both.listTools()
  assert.deepEqual(catalog.tools.map((t) => t.name).sort(), [
    'komisio_get_store_policy',
    'komisio_list_reception_operations',
    'komisio_list_receptions',
    'komisio_preview_reception',
    'komisio_read_reception',
    'komisio_read_reception_history',
    'komisio_read_reception_operation',
  ])
  assert(
    catalog.tools.every(
      (t) =>
        t.inputSchema.additionalProperties === false &&
        t.annotations.readOnlyHint,
    ),
  )
  const policyRead = await both.callTool({
    name: 'komisio_get_store_policy',
    arguments: {},
  })
  assert(!policyRead.isError)
  assert.equal(policyRead.structuredContent.policy.commissionRatePercent, 60)
  assert.equal(policyRead.structuredContent.version, 0)
  assert.equal(policyRead.structuredContent.readOnly, true)
  assert(
    (
      await both.callTool({
        name: 'komisio_get_store_policy',
        arguments: { tenantId: randomUUID() },
      })
    ).isError,
  )
  const read = await both.callTool({
    name: 'komisio_read_reception',
    arguments: { sessionId: session },
  })
  assert(!read.isError)
  assert.equal(read.structuredContent.source.session.revision, 1)
  assert(!JSON.stringify(read).includes('mcp-seller@example.test'))
  const queue = await both.callTool({
    name: 'komisio_list_receptions',
    arguments: { stage: 'preparing' },
  })
  assert(!queue.isError)
  assert.equal(queue.structuredContent.items[0].session_id, session)
  assert.equal(queue.structuredContent.readOnly, true)
  assert.equal(queue.structuredContent.items[0].nextStep, 'prepare_evidence')
  assert.equal(queue.structuredContent.items[0].guidanceOnly, true)
  assert(!JSON.stringify(queue).includes('mcp-seller@example.test'))
  for (const args of [
    { tenantId: randomUUID() },
    { stage: 'for_sale' },
    { beforeId: randomUUID() },
  ]) {
    assert(
      (
        await both.callTool({
          name: 'komisio_list_receptions',
          arguments: args,
        })
      ).isError,
    )
  }
  await assert.rejects(
    both.callTool({
      name: 'komisio_read_reception_photo',
      arguments: { sessionId: session, photoId, revision: 1 },
    }),
    /not found/,
  )
  const photos = await connect('reception:photos')
  assert.deepEqual(
    (await photos.listTools()).tools.map((t) => t.name),
    ['komisio_read_reception_photo'],
  )
  const photo = await photos.callTool({
    name: 'komisio_read_reception_photo',
    arguments: { sessionId: session, photoId, revision: 1 },
  })
  assert(!photo.isError)
  assert.equal(photo.structuredContent.sourceId, photoId)
  assert.equal(photo.structuredContent.sourceRevision, 1)
  assert.equal(photo.structuredContent.actor, uid)
  assert(!JSON.stringify(photo.structuredContent).includes(photoPath))
  const image = photo.content.find((c) => c.type === 'image')
  assert.equal(image.mimeType, 'image/jpeg')
  const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata()
  assert.equal(metadata.width, 40)
  assert.equal(metadata.exif, undefined)
  assert.equal(metadata.xmp, undefined)
  for (const args of [
    { sessionId: session, photoId, revision: 2 },
    { sessionId: session, photoId: randomUUID(), revision: 1 },
    {
      sessionId: session,
      photoId,
      revision: 1,
      url: 'https://untrusted.example/image.jpg',
    },
  ])
    assert(
      (
        await photos.callTool({
          name: 'komisio_read_reception_photo',
          arguments: args,
        })
      ).isError,
    )
  const suggestions = {
    metadata: {
      description: {
        value: 'Synthetic blue jacket',
        sourceIds: [source],
        certainty: 'observed',
      },
    },
    price: null,
    questions: ['Price evidence required'],
  }
  const preview = await both.callTool({
    name: 'komisio_preview_reception',
    arguments: { sessionId: session, revision: 1, suggestions },
  })
  assert(!preview.isError)
  assert.equal(preview.structuredContent.persisted, false)
  assert.equal(preview.structuredContent.staged, false)
  assert.equal(preview.structuredContent.actor, uid)
  assert.equal(
    preview.structuredContent.proposal.suggestions.metadata.description
      .certainty,
    'tentative',
  )
  const stale = await both.callTool({
    name: 'komisio_preview_reception',
    arguments: { sessionId: session, revision: 2, suggestions },
  })
  assert(stale.isError)
  const unknown = await both.callTool({
    name: 'komisio_read_reception',
    arguments: { sessionId: randomUUID() },
  })
  assert(unknown.isError)
  const injection = await both.callTool({
    name: 'komisio_read_reception',
    arguments: { sessionId: session, tenantId: randomUUID() },
  })
  assert(injection.isError)
  // Seed enough immutable source versions to exercise real history pagination.
  for (let revision = 1; revision <= 21; revision++) {
    await rpc('save_reception_sources', {
      p_tenant: tenant,
      p_request: randomUUID(),
      p_session: session,
      p_expected: revision,
      p_sources: [
        {
          id: randomUUID(),
          kind: 'observation',
          reference: 'MCP history fixture',
          observation: `Revision ${revision + 1}`,
        },
      ],
    })
  }
  const history = await both.callTool({
    name: 'komisio_read_reception_history',
    arguments: { sessionId: session },
  })
  assert(!history.isError)
  assert.equal(history.structuredContent.sources.length, 20)
  assert.equal(history.structuredContent.sources[0].revision, 22)
  assert.equal(history.structuredContent.nextSource, 3)
  assert.equal(history.structuredContent.summaryOnly, true)
  const olderHistory = await both.callTool({
    name: 'komisio_read_reception_history',
    arguments: { sessionId: session, beforeSource: 3 },
  })
  assert(!olderHistory.isError)
  assert.deepEqual(
    olderHistory.structuredContent.sources.map((s) => s.revision),
    [2, 1],
  )
  assert.equal(olderHistory.structuredContent.nextSource, null)
  assert(!JSON.stringify(olderHistory).includes(photoPath))
  assert(!JSON.stringify(history).includes('mcp-seller@example.test'))
  for (const args of [
    { sessionId: randomUUID() },
    { sessionId: session, beforeSource: 0 },
    { sessionId: session, beforeReview: 1.5 },
    { sessionId: session, tenantId: randomUUID() },
  ])
    assert(
      (
        await both.callTool({
          name: 'komisio_read_reception_history',
          arguments: args,
        })
      ).isError,
    )
  const readonly = await connect('reception:read')
  assert.deepEqual(
    (await readonly.listTools()).tools.map((t) => t.name),
    [
      'komisio_list_reception_operations',
      'komisio_get_store_policy',
      'komisio_read_reception_history',
      'komisio_list_receptions',
      'komisio_read_reception',
      'komisio_read_reception_operation',
    ],
  )
  await assert.rejects(
    readonly.callTool({
      name: 'komisio_preview_reception',
      arguments: { sessionId: session, revision: 1, suggestions },
    }),
    /not found/,
  )
  const invalid = await connect('reception:read', 'invalid-token')
  assert(
    (
      await invalid.callTool({
        name: 'komisio_read_reception',
        arguments: { sessionId: session },
      })
    ).isError,
  )
  const cross = await connect('reception:read', token, randomUUID())
  for (const denied of [invalid, cross]) {
    assert(
      (
        await denied.callTool({
          name: 'komisio_read_reception_history',
          arguments: { sessionId: session },
        })
      ).isError,
    )
    assert(
      (
        await denied.callTool({
          name: 'komisio_list_receptions',
          arguments: {},
        })
      ).isError,
    )
  }
  assert(
    (
      await cross.callTool({
        name: 'komisio_read_reception',
        arguments: { sessionId: session },
      })
    ).isError,
  )
  // Staged proposal: the host stages a complete review; a person approves through the engine.
  const agreement = await rpc('publish_seller_agreement', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_expected_current: null,
    p_title: 'TEST',
    p_body: 'Fictional terms',
    p_language: 'en',
    p_required: false,
  })
  // History seeding replaced the source list; restore the cited evidence as a new revision.
  const current = (
    await db.query(
      'select max(revision)::int as revision from reception_source_revisions where session_id=$1',
      [session],
    )
  ).rows[0].revision
  await rpc('save_reception_sources', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: session,
    p_expected: current,
    p_sources: [
      {
        id: source,
        kind: 'observation',
        reference: 'MCP fixture',
        observation: 'Synthetic blue jacket',
      },
      {
        id: price,
        kind: 'price-evidence',
        reference: 'MCP fixture appraisal',
        observation: 'Fictional 250 SEK',
      },
    ],
  })
  const proposedRevision = current + 1
  const proposer = await connect('reception:propose')
  assert.deepEqual(
    (await proposer.listTools()).tools.map((t) => t.name),
    ['komisio_propose_reception_review'],
  )
  const complete = {
    metadata: {
      description: {
        value: 'Synthetic blue jacket',
        sourceIds: [source],
        certainty: 'observed',
      },
    },
    price: {
      currency: 'SEK',
      amount: '250.00',
      rationale: 'Fixture appraisal',
      sourceIds: [price],
    },
    questions: [],
  }
  const proposalId = randomUUID()
  const proposal = {
    requestId: proposalId,
    sessionId: session,
    sourceRevision: proposedRevision,
    previousReviewId: null,
    agreementId: agreement,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    suggestions: complete,
  }
  const staged = await proposer.callTool({
    name: 'komisio_propose_reception_review',
    arguments: proposal,
  })
  assert(!staged.isError, JSON.stringify(staged.content))
  assert.equal(staged.structuredContent.staged, true)
  assert.equal(staged.structuredContent.executed, false)
  assert.equal(staged.structuredContent.requiresApproval, true)
  assert.equal(staged.structuredContent.operationId, proposalId)
  assert.equal(staged.structuredContent.actor, uid)
  const detail = await both.callTool({
    name: 'komisio_read_reception_operation',
    arguments: { operationId: proposalId },
  })
  assert(!detail.isError, JSON.stringify(detail.content))
  assert.equal(detail.structuredContent.context.terms.id, agreement)
  assert.equal(detail.structuredContent.context.canApprove, true)
  assert.equal(
    detail.structuredContent.operation.payload.suggestions.metadata.description
      .value,
    complete.metadata.description.value,
  )
  assert(
    detail.structuredContent.context.sources.every(
      (s) => s.kind !== 'photo' || s.reference === null,
    ),
  )
  for (const args of [
    { operationId: randomUUID() },
    { operationId: proposalId, tenantId: tenant },
  ])
    assert(
      (
        await both.callTool({
          name: 'komisio_read_reception_operation',
          arguments: args,
        })
      ).isError,
    )
  assert.equal(detail.structuredContent.context.terms.body, 'Fictional terms')
  for (const denied of [invalid, cross])
    assert(
      (
        await denied.callTool({
          name: 'komisio_read_reception_operation',
          arguments: { operationId: proposalId },
        })
      ).isError,
    )
  const staleId = randomUUID()
  assert(
    !(
      await proposer.callTool({
        name: 'komisio_propose_reception_review',
        arguments: { ...proposal, requestId: staleId },
      })
    ).isError,
  )
  assert(
    (
      await inspection.client.callTool({
        name: 'komisio_read_inspection_operation',
        arguments: { operationId: proposalId },
      })
    ).isError,
  )
  const replayed = await proposer.callTool({
    name: 'komisio_propose_reception_review',
    arguments: proposal,
  })
  assert(!replayed.isError, JSON.stringify(replayed.content))
  const storedExpiry = await db.query(
    'select expires_at from pending_operations where id=$1',
    [proposalId],
  )
  assert.equal(
    storedExpiry.rows[0].expires_at.toISOString(),
    proposal.expiresAt,
  )
  for (const args of [
    { ...proposal, requestId: randomUUID(), sourceRevision: current },
    { ...proposal, requestId: randomUUID(), riskLevel: 'low' },
    {
      ...proposal,
      requestId: randomUUID(),
      suggestions: { ...complete, price: null },
    },
    { ...proposal, requestId: randomUUID(), agreementId: randomUUID() },
  ])
    assert(
      (
        await proposer.callTool({
          name: 'komisio_propose_reception_review',
          arguments: args,
        })
      ).isError,
    )
  await assert.rejects(
    both.callTool({
      name: 'komisio_propose_reception_review',
      arguments: proposal,
    }),
    /not found/,
  )
  const stagedState = await db.query(
    'select (select count(*) from pending_operations where id=$1)::int ops,(select count(*) from reception_reviews where session_id=$2)::int reviews',
    [proposalId, session],
  )
  assert.deepEqual(stagedState.rows[0], { ops: 1, reviews: 0 })
  const decided = await app.rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: proposalId,
    p_decision: 'approved',
    p_reason: 'Fixture approval',
  })
  assert.ifError(decided.error)
  const executed = await db.query(
    'select outcome,result_id,(select created_by from reception_reviews where id=$1) as actor from operation_decisions where operation_id=$1',
    [proposalId],
  )
  assert.equal(executed.rows[0].outcome, 'executed')
  assert.equal(executed.rows[0].result_id, proposalId)
  assert.equal(executed.rows[0].actor, uid)
  const staleDetail = await both.callTool({
    name: 'komisio_read_reception_operation',
    arguments: { operationId: staleId },
  })
  assert(!staleDetail.isError)
  assert.equal(staleDetail.structuredContent.context.stale, true)
  assert.equal(staleDetail.structuredContent.context.canApprove, false)
  assert.equal(
    staleDetail.structuredContent.context.terms.body,
    'Fictional terms',
  )
  const revisionOperation = randomUUID()
  const revisedSuggestions = structuredClone(complete)
  revisedSuggestions.metadata.description.value = 'Revised fixture jacket'
  revisedSuggestions.price.rationale = 'Revised fixture rationale'
  const revisionStaged = await proposer.callTool({
    name: 'komisio_propose_reception_review',
    arguments: {
      ...proposal,
      requestId: revisionOperation,
      previousReviewId: proposalId,
      suggestions: revisedSuggestions,
    },
  })
  assert(!revisionStaged.isError, JSON.stringify(revisionStaged.content))
  const revisionDetail = await both.callTool({
    name: 'komisio_read_reception_operation',
    arguments: { operationId: revisionOperation },
  })
  assert(!revisionDetail.isError)
  const comparison = revisionDetail.structuredContent.context.comparison
  assert.equal(comparison.previousReviewId, proposalId)
  assert.equal(comparison.previousVersion, 1)
  assert.equal(
    comparison.fields[0].before.value,
    complete.metadata.description.value,
  )
  assert.equal(comparison.fields[0].after.value, 'Revised fixture jacket')
  assert.equal(comparison.price.before.amount, comparison.price.after.amount)
  assert.equal(comparison.price.after.rationale, 'Revised fixture rationale')
  assert.equal(comparison.agreementChanged, false)
  assert.equal(comparison.sourceRevisionChanged, false)
  const revised = await app.rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: revisionOperation,
    p_decision: 'approved',
    p_reason: 'Fixture revision',
  })
  assert.ifError(revised.error)
  const historical = await both.callTool({
    name: 'komisio_read_reception_operation',
    arguments: { operationId: revisionOperation },
  })
  assert(!historical.isError)
  assert.equal(historical.structuredContent.operation.outcome, 'executed')
  assert.deepEqual(historical.structuredContent.context.comparison, comparison)
  const discovery = await testOperationDiscovery({
    connect,
    rpc,
    db,
    uid,
    token,
  })
  await db.query(
    "insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values($1,$2,'totp','verified',now(),now())",
    [randomUUID(), uid],
  )
  for (const { client, name } of discovery)
    assert((await client.callTool({ name, arguments: {} })).isError)

  assert(
    (
      await inspection.previewer.callTool({
        name: 'komisio_prepare_inspection_reception',
        arguments: inspection.preparationInput,
      })
    ).isError,
  )
  assert(
    (
      await inspection.stager.callTool({
        name: 'komisio_propose_inspection_edit',
        arguments: inspection.stagedInput,
      })
    ).isError,
  )
  assert(
    (
      await inspection.previewer.callTool({
        name: 'komisio_preview_inspection',
        arguments: inspection.previewInput,
      })
    ).isError,
  )
  assert(
    (
      await inspection.client.callTool({
        name: 'komisio_list_bags',
        arguments: {},
      })
    ).isError,
  )
  assert(
    (
      await inspection.client.callTool({
        name: 'komisio_read_inspection',
        arguments: { bagId: inspection.bag },
      })
    ).isError,
  )
  assert(
    (
      await both.callTool({
        name: 'komisio_read_reception_history',
        arguments: { sessionId: session },
      })
    ).isError,
  )
  assert(
    (
      await both.callTool({
        name: 'komisio_read_reception_operation',
        arguments: { operationId: proposalId },
      })
    ).isError,
  )
  assert(
    (
      await proposer.callTool({
        name: 'komisio_propose_reception_review',
        arguments: { ...proposal, requestId: randomUUID() },
      })
    ).isError,
  )
  assert(
    (await both.callTool({ name: 'komisio_list_receptions', arguments: {} }))
      .isError,
  )
  assert(
    (
      await photos.callTool({
        name: 'komisio_read_reception_photo',
        arguments: { sessionId: session, photoId, revision: 1 },
      })
    ).isError,
  )
  assert(
    (
      await both.callTool({
        name: 'komisio_read_reception',
        arguments: { sessionId: session },
      })
    ).isError,
  )
  const records = await db.query(
    'select (select count(*) from reception_source_revisions where session_id=$1)::int sources,(select count(*) from reception_reviews where session_id=$1)::int reviews,(select count(*) from reception_assistance_attempts where session_id=$1)::int attempts',
    [session],
  )
  // 22 seeded history revisions plus the restored-evidence revision; both
  // reviews came from staff-approved staged operations, not from a tool.
  assert.deepEqual(records.rows[0], { sources: 23, reviews: 2, attempts: 0 })
  console.log(
    'PASS: real stdio MCP negotiation, authenticated reads, opt-in minimized image/provenance, unsaved preview, staged proposal with staff approval, scope/tenant/invalid-token/MFA/stale denial, no direct source/review/model writes.',
  )
} finally {
  await Promise.allSettled(clients.map((client) => client.close()))
  await db.end()
}
