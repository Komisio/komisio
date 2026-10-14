import { platformContext } from '@/lib/platform/context'
import {
  createCategoryInput,
  createItemCategory,
} from '@/lib/engine/item-categories'

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
    const parsed = createCategoryInput.safeParse(JSON.parse(text))
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin'].includes(ctx.active.role)) return reply({}, 403)
    return reply(await createItemCategory(ctx.client, parsed.data))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const known = [
      'FORBIDDEN',
      'AUTH_REQUIRED',
      'REQUEST_CONFLICT',
      'INVALID_INPUT',
      'CATEGORY_EXISTS',
    ].includes(code)
    return reply(
      { error: known ? code : 'REQUEST_FAILED' },
      code === 'FORBIDDEN'
        ? 403
        : code === 'AUTH_REQUIRED'
          ? 401
          : code === 'INVALID_INPUT'
            ? 400
            : known
              ? 409
              : 503,
    )
  }
}
