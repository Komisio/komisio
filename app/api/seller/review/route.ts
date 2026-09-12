import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  sellerResponseCommand,
  respondToReview,
} from '@/lib/engine/seller-review'
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
    const c = sellerResponseCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const result = await respondToReview(ctx.client, c.data)
    if (result.error) return reply({ error: 'REVIEW_UNAVAILABLE' }, 409)
    return reply({ id: result.data })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
