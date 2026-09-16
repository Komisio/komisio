import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  Client as MCPClient,
  InMemoryTransport,
} from '@modelcontextprotocol/client'
import { createReceptionMCP } from '../mcp/server'
import { hostedExcludedTools } from '../mcp/config'
import {
  authorizeConnector,
  connectorClient,
  issueTokens,
  pkceChallenge,
  readConnectors,
  readTokenInfo,
  registerClient,
  revokeConnector,
} from '../lib/engine/connectors'

// Called by scripts/test-mcp.mjs against the loopback Supabase with a
// confirmed fixture person of its own (no MFA). Walks the hosted connector
// end to end: registration, consent, code exchange with PKCE, a tool call as
// the approving person, a proposal that carries that person as proposer,
// refresh and revocation.
const url = process.env.KOMISIO_TEST_URL!,
  key = process.env.KOMISIO_TEST_KEY!,
  token = process.env.KOMISIO_TEST_TOKEN!,
  uid = process.env.KOMISIO_TEST_UID!
if (url !== 'http://127.0.0.1:54321') throw new Error('loopback only')
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const anon = createClient(url, key, options)
const person = createClient(url, key, {
  ...options,
  global: { headers: { Authorization: `Bearer ${token}` } },
})
const store = await person.rpc('create_tenant', {
  p_name: 'Connector fixture',
  p_slug: `connector-${randomUUID()}`,
  p_request_id: randomUUID(),
})
if (store.error) throw new Error('store creation failed')
const tenant = store.data as string
{
  const redirectUri = 'http://localhost:9/callback'
  const registered = await registerClient(anon, {
    client_name: 'Harness assistant',
    redirect_uris: [redirectUri],
  })
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const consent = await authorizeConnector(
    person,
    {
      tenantId: tenant,
      clientId: registered.client_id,
      redirectUri,
      scopes: ['items:read', 'items:propose', 'economy:read'],
      codeChallenge: pkceChallenge(verifier),
      state: 'harness-state',
    },
    'aal1',
  )
  const back = new URL(consent.redirect)
  assert.equal(back.searchParams.get('state'), 'harness-state')
  const code = back.searchParams.get('code')!
  await assert.rejects(
    issueTokens(anon, {
      grant_type: 'authorization_code',
      code,
      code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-wrong',
      client_id: registered.client_id,
      redirect_uri: redirectUri,
    }),
    /CONNECTOR_CODE_INVALID/,
  )
  const tokens = await issueTokens(anon, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: registered.client_id,
    redirect_uri: redirectUri,
  })
  const identity = await readTokenInfo(anon, tokens.access_token)
  assert('info' in identity)
  assert.equal(identity.info.userId, uid)
  assert.equal(identity.info.tenantId, tenant)
  async function connect(access: string) {
    const server = createReceptionMCP(connectorClient(anon, access), {
      url,
      key,
      tenantId: tenant,
      scopes: ['items:read', 'items:propose', 'economy:read'],
      userId: uid,
      hosted: true,
    })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)
    const client = new MCPClient({ name: 'harness', version: '1.0.0' })
    await client.connect(clientSide)
    return client
  }
  const assistant = await connect(tokens.access_token)
  const names = (await assistant.listTools()).tools.map((t) => t.name)
  assert(names.includes('komisio_find_items'))
  assert(names.includes('komisio_propose_acceptance'))
  assert(names.includes('komisio_read_seller_balance'))
  assert(!names.some((n) => hostedExcludedTools.has(n)))
  const found = await assistant.callTool({
    name: 'komisio_find_items',
    arguments: {},
  })
  assert(!found.isError, JSON.stringify(found.content))
  // A proposal through the connector names the person, so the person cannot approve it.
  const purchase = randomUUID()
  const registeredPurchase = await person.rpc('register_purchase', {
    p_tenant: tenant,
    p_id: purchase,
    p_note: 'connector fixture',
    p_price_ore: 12000,
    p_evidence: 'connector fixture receipt',
    p_margin_eligible: false,
  })
  assert.ifError(registeredPurchase.error)
  const operation = randomUUID()
  const proposed = await assistant.callTool({
    name: 'komisio_propose_acceptance',
    arguments: {
      requestId: operation,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      originKind: 'purchase',
      originId: purchase,
      originRevision: null,
      priceOre: 20000,
    },
  })
  assert(!proposed.isError, JSON.stringify(proposed.content))
  const row = await person
    .from('pending_operations')
    .select('proposed_by')
    .eq('id', operation)
    .maybeSingle()
  assert.equal(row.data?.proposed_by, uid)
  // Refresh rotates; the old refresh token then voids the grant if replayed.
  const refreshed = await issueTokens(anon, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: registered.client_id,
  })
  const rotated = await connect(refreshed.access_token)
  assert(
    !(await rotated.callTool({ name: 'komisio_find_items', arguments: {} }))
      .isError,
  )
  // Disconnecting under Settings stops the assistant at once.
  const listed = await readConnectors(person, tenant)
  assert(
    listed &&
      listed.length === 1 &&
      listed[0].clientName === 'Harness assistant' &&
      listed[0].calls >= 3,
  )
  await revokeConnector(person, tenant, listed[0].id)
  const after = await rotated.callTool({
    name: 'komisio_find_items',
    arguments: {},
  })
  assert(after.isError)
  await assert.rejects(
    issueTokens(anon, {
      grant_type: 'refresh_token',
      refresh_token: refreshed.refresh_token,
      client_id: registered.client_id,
    }),
    /CONNECTOR_REVOKED/,
  )
  await assistant.close()
  await rotated.close()
  console.log(
    'PASS: hosted connector registration, consent with PKCE, tool calls as the approving person, proposer provenance, refresh rotation and revocation',
  )
}
