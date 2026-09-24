import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { saveFlowCommand, saveStoreFlow } from '@/lib/engine/store-flow'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'FORBIDDEN' }, 403)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const raw = await request.text()
    if (raw.length > 40000) return reply({ error: 'INVALID_INPUT' }, 413)
    const input = saveFlowCommand.safeParse(JSON.parse(raw))
    if (!input.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (input.data.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const result = await saveStoreFlow(ctx.client, input.data)
    if (result.error)
      return reply(
        {
          error: result.error.message.includes('STALE_VERSION')
            ? 'STALE_VERSION'
            : 'REQUEST_FAILED',
        },
        result.error.message.includes('STALE_VERSION') ? 409 : 400,
      )
    return reply(result.data)
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 400)
  }
}
