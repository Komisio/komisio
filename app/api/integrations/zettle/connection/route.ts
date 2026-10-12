import { NextResponse } from 'next/server'
import {
  paypalEnvironment,
  disconnectPayPal,
  paypalErrorCode,
} from '@/lib/engine/paypal-credentials'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import { checkZettleConnection } from '@/lib/engine/zettle-connection'
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 49152)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({
        tenantId: z.uuid(),
        action: z.enum(['check', 'disconnect']).default('check'),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (parsed.data.action === 'disconnect')
      return reply(await disconnectPayPal(ctx.client, ctx.active.id))
    return reply(
      await checkZettleConnection(
        ctx.client,
        ctx.active.id,
        await paypalEnvironment(ctx.client, ctx.active.id, process.env),
      ),
    )
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'FORBIDDEN') return reply({ error: code }, 403)
    return reply(
      {
        error: paypalErrorCode(code),
      },
      409,
    )
  }
}
