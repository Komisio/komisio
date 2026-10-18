import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { storeMailCommand, executeStoreMail } from '@/lib/engine/store-mail'
import { processStoreMail } from '@/lib/communications/store-mail'

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
    if (text.length > 16000) return reply({ error: 'INVALID_INPUT' }, 413)
    const input = storeMailCommand.safeParse(JSON.parse(text))
    if (!input.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const c = input.data
    if (
      c.action !== 'consent' &&
      (ctx.active?.id !== c.tenantId ||
        !['owner', 'admin'].includes(ctx.active.role))
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    if (c.action === 'process')
      return reply(
        await processStoreMail(ctx.client, c.tenantId, c.sendId, origin),
      )
    const r = await executeStoreMail(ctx.client, c)
    if (r.error) throw new Error(r.error.message)
    return reply({ data: r.data })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    const error =
      [
        'AUDIENCE_CHANGED',
        'CONSENT_CHANGED',
        'EMAIL_DAILY_CAP',
        'STORE_EMAIL_MISSING',
        'NO_RECIPIENTS',
        'REQUEST_CONFLICT',
        'FORBIDDEN',
      ].find((code) => message.includes(code)) ?? 'REQUEST_FAILED'
    return reply({ error }, error === 'FORBIDDEN' ? 403 : 400)
  }
}
