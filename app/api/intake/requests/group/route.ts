import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  centralReviewCommand,
  executeCentralReview,
} from '@/lib/engine/central-item-review'
import {
  externalItemsEnabled,
  externalItemFailure,
} from '@/lib/platform/mobile-external-items'
import { postNordConfiguration } from '@/lib/platform/postnord'
import { serverClient } from '@/lib/supabase/server'
const reply = (body: object, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
export async function POST(request: Request) {
  if (!externalItemsEnabled()) return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    let input: unknown
    try {
      input = await boundedJson(request, 8192)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const c = centralReviewCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const config = postNordConfiguration()
    const client =
      c.data.action === 'approveAndBook' && config
        ? await serverClient({ 'x-komisio-shipping': config.serverKey })
        : ctx.client
    return reply(await executeCentralReview(client, c.data, config))
  } catch (error) {
    return externalItemFailure(error, null)
  }
}
