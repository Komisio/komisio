import { platformContext } from '@/lib/platform/context'
import {
  classificationCommand,
  classifyItems,
} from '@/lib/engine/item-classification'
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
    if (text.length > 24000) return reply({}, 413)
    const parsed = classificationCommand.safeParse(JSON.parse(text))
    if (!parsed.success) return reply({}, 400)
    if (ctx.active?.id !== parsed.data.tenantId) return reply({}, 409)
    if (
      !(
        parsed.data.action === 'group'
          ? ['owner', 'admin']
          : ['owner', 'admin', 'staff']
      ).includes(ctx.active.role)
    )
      return reply({}, 403)
    return reply(await classifyItems(ctx.client, parsed.data))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return reply(
      {
        error: ['REQUEST_FAILED', 'GROUP_EXISTS'].includes(code)
          ? code
          : 'CHANGED',
      },
      code === 'REQUEST_FAILED' ? 503 : 409,
    )
  }
}
