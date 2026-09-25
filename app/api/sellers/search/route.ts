import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { readSellersOverviewPage } from '@/lib/engine/sellers'

/** Bounded seller choices for reception; balances never leave this endpoint. */
export async function GET(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active) return reply({}, 401)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({}, 403)
    const params = new URL(request.url).searchParams
    if (params.get('tenant') !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const query = (params.get('q') ?? '').trim()
    const rawOffset = params.get('offset') ?? '0'
    const offset = Number(rawOffset)
    if (
      query.length > 120 ||
      !/^\d+$/.test(rawOffset) ||
      !Number.isSafeInteger(offset) ||
      offset > 2147483647
    )
      return reply({}, 400)
    const result = await readSellersOverviewPage(
      ctx.client,
      ctx.active.id,
      query,
      offset,
      12,
    )
    if (!result) return reply({ error: 'SEARCH_UNAVAILABLE' }, 503)
    return reply({
      sellers: result.sellers.map(({ id, name, contact }) => ({
        id,
        name,
        contact,
      })),
      total: result.total,
      offset: result.offset,
    })
  } catch {
    return reply({ error: 'SEARCH_FAILED' }, 500)
  }
}
