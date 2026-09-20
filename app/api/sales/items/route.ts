import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { searchSaleItems } from '@/lib/engine/sale-search'
export async function GET(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active) return reply({}, 401)
  if (ctx.active.role === 'readonly') return reply({}, 403)
  const url = new URL(request.url),
    query = (url.searchParams.get('q') ?? '').trim()
  if (url.searchParams.get('tenant') !== ctx.active.id) return reply({}, 409)
  if (query.length < 2 || query.length > 120) return reply({}, 400)
  try {
    return reply({
      items: await searchSaleItems(ctx.client, ctx.active.id, query),
    })
  } catch {
    return reply({ error: 'SEARCH_FAILED' }, 500)
  }
}
