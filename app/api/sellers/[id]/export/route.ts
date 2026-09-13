import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { readSellerDataExport } from '@/lib/engine/seller-export'

type RouteContext = { params: Promise<{ id: string }> }
const headers = { 'Cache-Control': 'no-store' }

/** Every row about one seller as a JSON file; owner or admin, logged in SQL. */
export async function GET(_request: Request, { params }: RouteContext) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404, headers })
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active)
      return new Response(null, { status: 401, headers })
    if (!['owner', 'admin'].includes(ctx.active.role))
      return new Response(null, { status: 403, headers })
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return new Response(null, { status: 404, headers })
    let data
    try {
      data = await readSellerDataExport(ctx.client, ctx.active.id, id.data)
    } catch (e) {
      const notFound = e instanceof Error && e.message === 'SELLER_NOT_FOUND'
      return new Response(null, { status: notFound ? 404 : 403, headers })
    }
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="komisio-seller-${id.data.slice(0, 8)}-${data.exportedAt.slice(0, 10)}.json"`,
      },
    })
  } catch {
    return new Response(null, { status: 500, headers })
  }
}
