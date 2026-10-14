import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  eraseSellerContact,
  eraseSellerContactCommand,
  privacyErrors,
} from '@/lib/engine/seller-privacy'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const reply = (body: object, status = 200) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active)
      return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const body = eraseSellerContactCommand.parse(
      await boundedJson(request, 8192),
    )
    if (body.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (body.sellerId !== (await params).id)
      return reply({ error: 'INVALID_INPUT' }, 400)
    const id = await eraseSellerContact(ctx.client, body)
    return reply({ id })
  } catch (e) {
    const code =
      e instanceof z.ZodError || e instanceof SyntaxError
        ? 'INVALID_INPUT'
        : e instanceof Error
          ? e.message
          : ''
    const known = privacyErrors.find((c) => c === code)
    return reply(
      { error: known ?? 'REQUEST_FAILED' },
      known === 'FORBIDDEN'
        ? 403
        : known === 'SELLER_NOT_FOUND'
          ? 404
          : known === 'INVALID_INPUT'
            ? 400
            : known
              ? 409
              : 503,
    )
  }
}
