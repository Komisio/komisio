import { boundedJson } from '@/lib/http/bounded-json'
import { platformContext } from '@/lib/platform/context'
import {
  keyCommand,
  manageInventoryKey,
} from '@/lib/engine/store-inventory-api'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const input = keyCommand.safeParse(
      await boundedJson(request, 2048).catch(() => null),
    )
    if (!input.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== input.data.tenantId || ctx.active.role !== 'owner')
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(await manageInventoryKey(ctx.client, input.data))
  } catch (e) {
    if (e instanceof Error && e.message === 'KEY_LIMIT')
      return reply({ error: 'KEY_LIMIT' }, 409)
    return reply({ error: 'REQUEST_FAILED' }, 503)
  }
}
