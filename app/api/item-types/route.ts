import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  createItemType,
  createItemTypeInput,
} from '@/lib/engine/create-item-type'

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
    const parsed = createItemTypeInput.safeParse(await request.json())
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(await createItemType(ctx.client, parsed.data))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (
      [
        'FORBIDDEN',
        'AUTH_REQUIRED',
        'REQUEST_CONFLICT',
        'INVALID_INPUT',
      ].includes(code)
    )
      return reply(
        { error: code },
        code === 'FORBIDDEN'
          ? 403
          : code === 'AUTH_REQUIRED'
            ? 401
            : code === 'REQUEST_CONFLICT'
              ? 409
              : 400,
      )
    console.error('Item type creation failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
