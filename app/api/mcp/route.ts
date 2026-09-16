import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  anonClient,
  appOrigin,
  connectorClient,
  connectorsEnabled,
  readTokenInfo,
} from '@/lib/engine/connectors'
import { supabaseEnv } from '@/lib/supabase/env'
import { createReceptionMCP } from '@/mcp/server'

// The hosted MCP endpoint (Streamable HTTP, stateless). A bearer token from
// the token endpoint identifies one grant: one store, one person, a set of
// scopes. The same tool catalogue as the local MCP is served, minus the tools
// that read tables directly (docs/HOSTED-MCP.md); every tool call runs
// through connector_call in SQL as the person who approved the grant.
function challenge(error: 'invalid_request' | 'invalid_token') {
  const meta = `${appOrigin()}/.well-known/oauth-protected-resource/api/mcp`
  return new Response(JSON.stringify({ error }), {
    status: 401,
    headers: {
      'WWW-Authenticate': `Bearer resource_metadata="${meta}"${error === 'invalid_token' ? ', error="invalid_token"' : ''}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}
export async function POST(request: Request) {
  if (!connectorsEnabled()) return new Response(null, { status: 404 })
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return challenge('invalid_request')
  const base = anonClient()
  const identity = await readTokenInfo(base, token)
  if ('error' in identity) {
    if (identity.error === 'PLAN_PLUS_REQUIRED')
      return new Response(JSON.stringify({ error: 'plan_plus_required' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    return challenge('invalid_token')
  }
  const { url, key } = supabaseEnv()
  const info = identity.info
  const handler = createMcpHandler(
    () =>
      createReceptionMCP(connectorClient(base, token), {
        url,
        key,
        tenantId: info.tenantId,
        scopes: info.scopes,
        userId: info.userId,
        hosted: true,
      }),
    { legacy: 'stateless', responseMode: 'json', onerror: () => {} },
  )
  try {
    const response = await handler.fetch(request)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } finally {
    await handler.close()
  }
}
const notAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } })
export async function GET() {
  return notAllowed()
}
export async function DELETE() {
  return notAllowed()
}
