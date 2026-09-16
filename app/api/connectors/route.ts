import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  connectorsEnabled,
  readConnectors,
  revokeConnector,
} from '@/lib/engine/connectors'

/** Disconnect an assistant: owners and admins any grant of the store, others their own. */
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
    if (!ctx.active) return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 1024)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({ tenantId: z.uuid(), grantId: z.uuid() })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    await revokeConnector(ctx.client, ctx.active.id, parsed.data.grantId)
    return reply({
      connectors: (await readConnectors(ctx.client, ctx.active.id)) ?? [],
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'REQUEST_FAILED'
    return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 400)
  }
}
