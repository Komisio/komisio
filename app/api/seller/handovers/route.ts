import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  executeSellerHandover,
  sellerHandoverCommand,
} from '@/lib/engine/handovers'

/** Seller-side handover commands; SQL verifies the seller identity. */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const text = await request.text()
    if (text.length > 4096) return reply({ error: 'INVALID_INPUT' }, 413)
    const c = sellerHandoverCommand.safeParse(JSON.parse(text))
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const r = await executeSellerHandover(ctx.client, c.data)
    if (r.error) {
      const error =
        [
          'FORBIDDEN',
          'AUTH_REQUIRED',
          'HANDOVER_NOT_ENABLED',
          'HANDOVER_NOT_FOUND',
          'HANDOVER_DECIDED',
          'REQUEST_CONFLICT',
          'INVALID_INPUT',
        ].find((e) => r.error!.message.includes(e)) ?? 'REQUEST_FAILED'
      return reply(
        { error },
        error === 'FORBIDDEN' ? 403 : error === 'INVALID_INPUT' ? 400 : 409,
      )
    }
    return reply({ ok: true, id: r.data })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 400)
  }
}
