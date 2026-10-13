import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import { posCommand } from '@/lib/pos-import'
import { runPosImport } from '@/lib/engine/pos-import'
import { inventoryImportErrors } from '@/lib/engine/inventory-import'

const errors = [
  ...inventoryImportErrors,
  'POS_CONNECTION_CHANGED',
  'POS_REVIEW_EXPIRED',
  'POS_ALREADY_LINKED',
  'POS_ITEM_UNSUPPORTED',
  'POS_PRICE_MISMATCH',
  'ITEM_NOT_FOUND',
  'ITEM_NOT_ON_SALE',
  'POS_NOT_CONNECTED',
  'POS_READ_FAILED',
  'POS_RATE_LIMITED',
  'POS_PAGE_TOO_LARGE',
  'SHOPIFY_NOT_CONNECTED',
  'SHOPIFY_AUTH_REQUIRED',
  'ZETTLE_NOT_CONNECTED',
  'PAYPAL_RECONNECT_REQUIRED',
]
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const c = posCommand.safeParse(
      await boundedJson(request, 16000).catch(() => null),
    )
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    return reply(await runPosImport(ctx.client, ctx.user.id, c.data))
  } catch (e) {
    const code =
      e instanceof Error && errors.includes(e.message)
        ? e.message
        : 'REQUEST_FAILED'
    return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 409)
  }
}
