import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { sendSellerCommunicationCommand } from '@/lib/engine/communications'
import { sendSellerCommunication } from '@/lib/communications/dispatch'

/** Queue, send and record one seller message. SQL authorizes and binds the facts. */
export async function POST(request: Request) {
  const requestId = randomUUID()
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  if (Number(request.headers.get('content-length') ?? 0) > 16000)
    return reply({ error: 'INVALID_INPUT' }, 413)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const parsed = sendSellerCommunicationCommand.safeParse(
      await request.json(),
    )
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (c.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
    const sent = await sendSellerCommunication(ctx.client, {
      tenantId: c.tenantId,
      storeName: ctx.active.name,
      locale: ctx.locale,
      requestId: c.requestId,
      sellerId: c.sellerId,
      kind: c.kind,
      referenceId: c.referenceId,
      freeText: c.freeText,
    })
    if (!sent.ok)
      return reply(
        { error: sent.error },
        sent.error === 'FORBIDDEN'
          ? 403
          : sent.error === 'REQUEST_CONFLICT'
            ? 409
            : sent.error === 'REQUEST_FAILED'
              ? 500
              : 400,
      )
    return reply({ ok: true, id: sent.id, delivery: sent.delivery })
  } catch {
    // Never log bodies, addresses or provider responses.
    console.error('Communication request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
