import { platformContext } from '@/lib/platform/context'
import { labelSheetQuery, readLabelSheet } from '@/lib/engine/label-sheets'
import { renderLabelSheetPdf } from '@/lib/documents/label-sheet-pdf'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  const fail = (status: number) =>
    new Response(null, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return fail(404)
  const parsed = labelSheetQuery.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return fail(400)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active) return fail(401)
    if (!['owner', 'admin', 'staff', 'readonly'].includes(ctx.active.role))
      return fail(403)
    if (ctx.active.id !== parsed.data.tenant) return fail(409)
    const sheet = await readLabelSheet(ctx.client, parsed.data)
    if (!sheet.items.length || sheet.items.length * parsed.data.copies > 400)
      return fail(422)
    const bytes = await renderLabelSheetPdf({
      ...parsed.data,
      items: sheet.items,
      storeName: ctx.active.name,
      locale: ctx.locale,
    })
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${parsed.data.download ? 'attachment' : 'inline'}; filename="komisio-labels.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch {
    return fail(503)
  }
}
