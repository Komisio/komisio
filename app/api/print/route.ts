import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  queuePrintJobInput,
  queueRenderedLabel,
  printErrorCodes,
} from '@/lib/engine/printing'

/** Render a label from the referenced fact and queue it for a printer. */
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
  if (Number(request.headers.get('content-length') ?? 0) > 4000)
    return reply({ error: 'INVALID_INPUT' }, 413)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const parsed = queuePrintJobInput.safeParse(await request.json())
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (c.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(
      await queueRenderedLabel(ctx.client, c, ctx.active.name, origin),
    )
  } catch (error) {
    const code = printErrorCodes.find(
      (value) => error instanceof Error && error.message === value,
    )
    if (code)
      return reply(
        { error: code },
        code === 'FORBIDDEN' ? 403 : code === 'REQUEST_CONFLICT' ? 409 : 400,
      )
    console.error('Print request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
