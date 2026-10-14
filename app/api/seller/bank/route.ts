import { platformContext } from '@/lib/platform/context'
import { bankCommand, executeBankCommand } from '@/lib/engine/seller-bank'
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({}, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({}, 401)
    const text = await request.text()
    if (text.length > 4000) return reply({}, 413)
    const parsed = bankCommand.safeParse(JSON.parse(text))
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (
      parsed.data.action === 'review' &&
      (ctx.active?.id !== parsed.data.tenantId ||
        !['owner', 'admin'].includes(ctx.active.role))
    )
      return reply({}, 403)
    return reply(await executeBankCommand(ctx.client, parsed.data))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return [
      'FORBIDDEN',
      'INVALID_INPUT',
      'REQUEST_CONFLICT',
      'BANK_DETAILS_CHANGED',
      'PAYOUT_NOT_APPROVED',
      'SELLER_CLOSED',
    ].includes(code)
      ? reply({ error: code }, 409)
      : reply({}, 503)
  }
}
