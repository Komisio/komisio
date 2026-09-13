import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { readAccountingExport } from '@/lib/engine/accounting'
import { renderSie4 } from '@/lib/accounting/sie'

type RouteContext = { params: Promise<{ id: string }> }
const headers = { 'Cache-Control': 'no-store' }

/** The SIE 4 file for one recorded export, rendered from the recorded lines. */
export async function GET(_request: Request, { params }: RouteContext) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404, headers })
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active)
      return new Response(null, { status: 401, headers })
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return new Response(null, { status: 404, headers })
    const row = await readAccountingExport(ctx.client, ctx.active.id, id.data)
    if (!row) return new Response(null, { status: 404, headers })
    const file = renderSie4({
      storeName: ctx.active.name,
      closeDate: row.closeDate,
      closeVersion: row.closeVersion,
      generatedOn: new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Europe/Stockholm',
      }),
      lines: row.voucher,
    })
    return new Response(file, {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="komisio-dagsavslut-${row.closeDate}-v${row.closeVersion}.se"`,
      },
    })
  } catch {
    return new Response(null, { status: 500, headers })
  }
}
