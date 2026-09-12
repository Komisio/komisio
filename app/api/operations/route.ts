import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  decideOperationCommand,
  decideOperation,
  operationErrorCode,
} from '@/lib/engine/operations'
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
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    let input: unknown
    try {
      input = await boundedJson(request)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const c = decideOperationCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const result = await decideOperation(ctx.client, c.data)
    if (result.error) {
      const code = operationErrorCode(result.error.message)
      return reply(
        { error: code },
        ['FORBIDDEN', 'AUTH_REQUIRED'].includes(code)
          ? 403
          : code === 'INVALID_INPUT'
            ? 400
            : 409,
      )
    }
    return reply({ id: result.data })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
