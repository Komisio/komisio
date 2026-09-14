import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  automationErrorCodes,
  automationScopes,
  disableAutomation,
  enableAutomation,
  readAutomation,
} from '@/lib/engine/automation'

/** Owner switches for automation scopes: enable, disable, read. */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || ctx.active.role !== 'owner')
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 1024)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({
        tenantId: z.uuid(),
        scope: z.enum(automationScopes),
        action: z.enum(['enable', 'disable']),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (parsed.data.action === 'enable')
      await enableAutomation(
        ctx.client,
        ctx.active.id,
        randomUUID(),
        parsed.data.scope,
      )
    else await disableAutomation(ctx.client, ctx.active.id, parsed.data.scope)
    return reply({
      grants: (await readAutomation(ctx.client, ctx.active.id)) ?? [],
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    const code =
      automationErrorCodes.find((c) => c === message) ?? 'REQUEST_FAILED'
    return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 409)
  }
}
