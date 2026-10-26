import { after, NextResponse } from 'next/server'
import { notifyRegistrationApproval } from '@/lib/communications/registration-approval'
import { platformContext } from '@/lib/platform/context'
import {
  registrationCommand,
  executeRegistration,
} from '@/lib/engine/seller-registration'

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
    const text = await request.text()
    if (text.length > 4000) return reply({ error: 'INVALID_INPUT' }, 413)
    const parsed = registrationCommand.safeParse(JSON.parse(text))
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const c = parsed.data
    if (
      c.action !== 'apply' &&
      (ctx.active?.id !== c.tenantId ||
        !['owner', 'admin', 'staff'].includes(ctx.active.role))
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    if (
      c.action === 'mailSettings' &&
      !['owner', 'admin'].includes(ctx.active?.role ?? '')
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    const result = await executeRegistration(ctx.client, c, ctx.locale)
    if (result.error) throw new Error(result.error.message)
    if (c.action === 'review' && c.approved) {
      after(async () => {
        try {
          await notifyRegistrationApproval(ctx.client, c.tenantId, c.requestId)
        } catch {
          console.error('Registration approval notification did not complete', {
            requestId: c.requestId,
          })
        }
      })
    }
    return reply({ data: result.data })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    const error =
      [
        'REGISTRATION_CHANGED',
        'CONSENT_CHANGED',
        'REGISTRATION_DISABLED',
        'REGISTRATION_REVIEWED',
        'REGISTRATION_EMAIL_CHANGED',
        'REGISTRATION_AMBIGUOUS',
        'AGREEMENT_REQUIRED',
        'AGREEMENT_CHANGED',
        'REQUEST_CONFLICT',
        'INVALID_INPUT',
        'AUTH_REQUIRED',
        'FORBIDDEN',
      ].find((code) => message === code) ?? 'REQUEST_FAILED'
    // Unknown transport/server failures may follow a committed command. Keep
    // the browser on the same request ID until it receives a definite outcome.
    return reply(
      { error },
      error === 'FORBIDDEN'
        ? 403
        : error === 'AUTH_REQUIRED'
          ? 401
          : error === 'REQUEST_FAILED'
            ? 503
            : 400,
    )
  }
}
