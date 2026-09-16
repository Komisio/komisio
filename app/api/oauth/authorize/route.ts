import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  authorizeConnector,
  connectorsEnabled,
  consentDecision,
  readClient,
} from '@/lib/engine/connectors'

/** The consent decision: the signed-in member approves a client for one store; the reply is where to send the browser. */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (!connectorsEnabled()) return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    let input: unknown
    try {
      input = await boundedJson(request, 8192)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = consentDecision.safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const membership = ctx.tenants.find((t) => t.id === parsed.data.tenantId)
    if (
      !membership ||
      !['owner', 'admin', 'staff', 'readonly'].includes(membership.role)
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    const client = await readClient(ctx.client, parsed.data.clientId)
    if (!client || !client.redirectUris.includes(parsed.data.redirectUri))
      return reply({ error: 'INVALID_INPUT' }, 400)
    const { data: assurance } =
      await ctx.client.auth.mfa.getAuthenticatorAssuranceLevel()
    const aal = assurance?.currentLevel === 'aal2' ? 'aal2' : 'aal1'
    return reply(await authorizeConnector(ctx.client, parsed.data, aal))
  } catch (e) {
    const code = e instanceof Error ? e.message : 'REQUEST_FAILED'
    if (code === 'PLAN_PLUS_REQUIRED') return reply({ error: code }, 403)
    return reply({ error: 'REQUEST_FAILED' }, 400)
  }
}
