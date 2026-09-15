import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  checkShopifyConnection,
  disconnectShopify,
  shopifyErrorCode,
} from '@/lib/engine/shopify-connection'

/** Check the connected shop or disconnect; owner or admin. Nothing is exported or imported here. */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 4096)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({
        tenantId: z.uuid(),
        action: z.enum(['check', 'disconnect']),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (parsed.data.action === 'disconnect')
      return reply(await disconnectShopify(ctx.client, ctx.active.id))
    return reply(
      await checkShopifyConnection(ctx.client, ctx.active.id, process.env),
    )
  } catch (e) {
    const code = shopifyErrorCode(e instanceof Error ? e.message : '')
    return reply(
      { error: code },
      code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400 : 409,
    )
  }
}
