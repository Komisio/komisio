import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  prepareSubmissionCommand,
  prepareSubmissionReception,
} from '@/lib/engine/submission-reception'
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (
    process.env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true'
  )
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const parsed = prepareSubmissionCommand.safeParse(
      await boundedJson(request, 8192),
    )
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== parsed.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    return reply(await prepareSubmissionReception(ctx.client, parsed.data))
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 409)
  }
}
