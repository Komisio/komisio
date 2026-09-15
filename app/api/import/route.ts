import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  stageImportCommand,
  stageSellerImport,
} from '@/lib/engine/import-sellers'
import { operationErrorCode } from '@/lib/engine/operations'

/** Stages a seller import as one low-risk operation; owner or admin. Nothing is registered here. */
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
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 262144)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const c = stageImportCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (c.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const result = await stageSellerImport(ctx.client, c.data)
    if (result.error) {
      const code = operationErrorCode(result.error.message)
      return reply(
        { error: code },
        code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400 : 409,
      )
    }
    return reply({ ok: true, operationId: c.data.requestId })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
