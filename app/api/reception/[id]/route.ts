import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import {
  readReceptionSession,
  readReceptionReview,
} from '@/lib/engine/reception-store'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return reply({ error: 'NOT_FOUND' }, 404)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active) return reply({ error: 'NOT_FOUND' }, 404)
    const reception = await readReceptionSession(ctx.client, ctx.active.id, id)
    if (!reception) return reply({ error: 'NOT_FOUND' }, 404)
    const review = await readReceptionReview(ctx.client, ctx.active.id, id)
    return reply({
      ...reception,
      latestReview: review
        ? {
            ...review,
            sourceCurrent:
              reception.status === 'ready' &&
              reception.session.revision === review.sourceRevision,
            expired: review.expired,
          }
        : null,
    })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
