import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  billingErrorCode,
  openPortal,
  startCheckout,
} from '@/lib/engine/billing'

/** Owner actions: start Checkout or open the customer portal. Returns a Stripe URL. */
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
        action: z.enum(['checkout', 'portal']),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const base = new URL(origin).origin
    return reply(
      parsed.data.action === 'checkout'
        ? await startCheckout(
            ctx.client,
            ctx.active.id,
            ctx.user.email ?? '',
            base,
            process.env,
          )
        : await openPortal(ctx.client, ctx.active.id, base, process.env),
    )
  } catch (e) {
    const code = billingErrorCode(e instanceof Error ? e.message : '')
    return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 409)
  }
}
