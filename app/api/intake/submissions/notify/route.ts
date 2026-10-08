import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import { notifySubmissionReview } from '@/lib/communications/submission-notification'
export async function POST(request: Request) {
  const reply = (b: object, s = 200) =>
    NextResponse.json(b, {
      status: s,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const c = z
      .strictObject({ tenantId: z.uuid(), reviewId: z.uuid() })
      .parse(await boundedJson(request, 2048))
    if (
      ctx.active?.id !== c.tenantId ||
      !['owner', 'admin', 'staff'].includes(ctx.active.role)
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply({
      delivery: await notifySubmissionReview(
        ctx.client,
        {
          tenantId: c.tenantId,
          storeName: ctx.active.name,
          locale: ctx.locale,
        },
        c.reviewId,
        true,
      ),
    })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 409)
  }
}
