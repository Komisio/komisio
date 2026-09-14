import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { billingActorClient } from '@/lib/engine/billing'
import { sendDueNotices } from '@/lib/engine/plan-notices'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Daily (Vercel Cron): trial and grace notices to store owners, as the billing actor. */
export async function GET(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  const secret = process.env.CRON_SECRET ?? ''
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (secret.length < 16 || !origin) return reply({ error: 'NOT_FOUND' }, 404)
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const client = await billingActorClient()
    if (!client) return reply({ error: 'BILLING_ACTOR_UNAVAILABLE' }, 503)
    try {
      const sent = await sendDueNotices(client, new URL(origin).origin)
      return reply({ notices: sent.length, sent })
    } finally {
      await client.auth.signOut().catch(() => undefined)
    }
  } catch (e) {
    console.error('Plan notices failed', {
      code: e instanceof Error ? e.message : 'unknown',
    })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
