import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { serverClient } from '@/lib/supabase/server'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  runSellerAssistance,
  sellerAssistanceCommand,
} from '@/lib/engine/seller-assistance'

export const maxDuration = 60
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
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
  const secret = process.env.KOMISIO_SELLER_AI_SERVER_KEY
  if (!secret || process.env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai')
    return reply({ error: 'ASSISTANCE_DISABLED' }, 503)
  try {
    const input = sellerAssistanceCommand.safeParse(
      await boundedJson(request, 4096),
    )
    if (!input.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const client = await serverClient({ 'x-komisio-seller-ai': secret })
    return reply(
      await runSellerAssistance(client, input.data, AbortSignal.timeout(45000)),
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const safe = [
      'ASSISTANCE_DISABLED',
      'ASSISTANCE_LIMIT',
      'AI_CREDITS_EXHAUSTED',
      'AI_CAP_REACHED',
      'USAGE_QUOTA_EXCEEDED',
      'FORBIDDEN',
      'REQUEST_CONFLICT',
    ].includes(code)
      ? code
      : 'ASSISTANCE_FAILED'
    return reply({ error: safe }, safe === 'FORBIDDEN' ? 403 : 409)
  }
}
