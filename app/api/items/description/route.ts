import { platformContext } from '@/lib/platform/context'
import {
  editDescriptionInput,
  editItemDescription,
} from '@/lib/engine/item-presentation'
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({}, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({}, 401)
    const text = await request.text()
    if (text.length > 16000) return reply({}, 413)
    const parsed = editDescriptionInput.safeParse(JSON.parse(text))
    if (!parsed.success) return reply({}, 400)
    if (ctx.active?.id !== parsed.data.tenantId) return reply({}, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({}, 403)
    return reply({
      ok: true,
      ...(await editItemDescription(ctx.client, parsed.data)),
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return [
      'ITEM_CHANGED',
      'ITEM_NOT_FOUND',
      'REQUEST_CONFLICT',
      'INVALID_INPUT',
      'FORBIDDEN',
    ].includes(code)
      ? reply({ error: code }, 409)
      : reply({}, 503)
  }
}
