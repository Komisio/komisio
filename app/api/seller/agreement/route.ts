import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  acceptMySellerAgreement,
  sellerAgreementCommand,
} from '@/lib/engine/seller-agreement'

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
    if (text.length > 4096) return reply({ error: 'INVALID_INPUT' }, 413)
    const command = sellerAgreementCommand.safeParse(JSON.parse(text))
    if (!command.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const result = await acceptMySellerAgreement(ctx.client, command.data)
    if (result.error) {
      const error =
        [
          'FORBIDDEN',
          'AUTH_REQUIRED',
          'AGREEMENT_CHANGED',
          'REQUEST_CONFLICT',
          'INVALID_INPUT',
        ].find((code) => result.error!.message.includes(code)) ??
        'REQUEST_FAILED'
      return reply(
        { error },
        error === 'FORBIDDEN' ? 403 : error === 'AGREEMENT_CHANGED' ? 409 : 400,
      )
    }
    return reply({ ok: true, id: result.data })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 400)
  }
}
