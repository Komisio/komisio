import { platformContext } from '@/lib/platform/context'
import {
  inventoryRowCommand,
  editInventoryRow,
} from '@/lib/engine/inventory-row'
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
    if (text.length > 20000) return reply({}, 413)
    const parsed = inventoryRowCommand.safeParse(JSON.parse(text))
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== parsed.data.tenantId) return reply({}, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({}, 403)
    return reply(await editInventoryRow(ctx.client, parsed.data))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return [
      'FORBIDDEN',
      'INVALID_INPUT',
      'ITEM_CHANGED',
      'REQUEST_CONFLICT',
      'ITEM_NOT_FOUND',
      'GROUP_NOT_FOUND',
      'ITEM_TYPE_UNDEFINED',
      'CATEGORY_NOT_FOUND',
      'CATALOGUE_CHANGED',
    ].includes(code)
      ? reply({ error: code }, 409)
      : reply({}, 503)
  }
}
