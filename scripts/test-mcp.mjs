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
    source = randomUUID()
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
  const both = await connect('reception:read,reception:preview')
  const catalog = await both.listTools()
  assert.deepEqual(catalog.tools.map((t) => t.name).sort(), [
    'komisio_list_receptions',
    'komisio_preview_reception',
    'komisio_read_reception',
    'komisio_read_reception_history',
  ])
  assert(
    catalog.tools.every(
      (t) =>
        t.inputSchema.additionalProperties === false &&
        t.annotations.readOnlyHint,
    ),
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
      'komisio_read_reception_history',
      'komisio_list_receptions',
      'komisio_read_reception',
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
  await db.query(
    "insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values($1,$2,'totp','verified',now(),now())",
    [randomUUID(), uid],
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
  assert.deepEqual(records.rows[0], { sources: 22, reviews: 0, attempts: 0 })
  console.log(
    'PASS: real stdio MCP negotiation, authenticated reads, opt-in minimized image/provenance, unsaved preview, scope/tenant/invalid-token/MFA/stale denial, no source/review/model writes.',
  )
} finally {
  await Promise.allSettled(clients.map((client) => client.close()))
  await db.end()
}
