import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readStocktakeExport,
  stocktakeCsv,
  stocktakeExportFilter,
} from '@/lib/engine/stocktake-export'

const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404, headers })
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active)
      return new Response(null, { status: 401, headers })
    const url = new URL(request.url)
    if (url.searchParams.get('tenant') !== ctx.active.id)
      return new Response(null, { status: 409, headers })
    const id = z.uuid().safeParse((await params).id)
    const filter = stocktakeExportFilter.safeParse(
      url.searchParams.get('filter'),
    )
    if (!id.success || !filter.success)
      return new Response(null, { status: 400, headers })
    const report = await readStocktakeExport(
      ctx.client,
      ctx.active.id,
      id.data,
      filter.data,
    )
    const csv = stocktakeCsv(
      report,
      ctx.active.name,
      dictionary(ctx.locale).stocktake,
    )
    return new Response(csv, {
      headers: {
        ...headers,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="komisio-stocktake-${id.data}-${filter.data}.csv"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status =
      message === 'STOCKTAKE_EXPORT_TOO_LARGE'
        ? 413
        : message === 'STOCKTAKE_NOT_FOUND'
          ? 404
          : message === 'STOCKTAKE_OPEN'
            ? 409
            : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(message)
              ? 403
              : 500
    return new Response(null, { status, headers })
  }
}
