import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  manageWeblink,
  weblinkCommand,
  weblinkErrors,
} from '@/lib/engine/weblink-printers'

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
    const input = await boundedJson(request, 4096).catch(() => null)
    const parsed = weblinkCommand.safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (
      parsed.data.action === 'register' &&
      process.env.KOMISIO_WEBLINK_SETUP_ENABLED !== 'true'
    )
      return reply({ error: 'NOT_FOUND' }, 404)
    return reply(await manageWeblink(ctx.client, parsed.data))
  } catch (error) {
    const code =
      error instanceof Error && weblinkErrors.find((c) => c === error.message)
    return reply(
      { error: code || 'REQUEST_FAILED' },
      code === 'FORBIDDEN'
        ? 403
        : code === 'AUTH_REQUIRED'
          ? 401
          : code
            ? 400
            : 503,
    )
  }
}
