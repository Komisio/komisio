import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  reviewSubmissionCommand,
  reviewSellerSubmission,
  submissionError,
} from '@/lib/engine/seller-submissions'
const reply = (body: object, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
export async function POST(request: Request) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const c = reviewSubmissionCommand.safeParse(
      await boundedJson(request, 8192),
    )
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    return reply(await reviewSellerSubmission(ctx.client, c.data))
  } catch (error) {
    const code = submissionError(error instanceof Error ? error.message : '')
    return reply(
      { error: code },
      code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400 : 409,
    )
  }
}
