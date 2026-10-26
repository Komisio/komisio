import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { readSaleSummary } from '@/lib/engine/sale-summary'
import {
  renderSaleSummaryPdf,
  saleSummaryPdfResponse,
} from '@/lib/documents/sale-summary-pdf'

export const runtime = 'nodejs'
const query = z.object({ tenant: z.uuid(), sale: z.uuid() })
export async function GET(request: Request) {
  const fail = (status: number) =>
    new Response(null, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return fail(404)
  const parsed = query.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return fail(400)
  try {
    const ctx = await platformContext()
    if (
      !ctx ||
      !ctx.user.email_confirmed_at ||
      ctx.mfaRequired ||
      ctx.user.app_metadata.komisio_password_recovery_pending === true
    )
      return fail(401)
    if (
      !ctx.active ||
      !['owner', 'admin', 'staff', 'readonly'].includes(ctx.active.role)
    )
      return fail(403)
    if (ctx.active.id !== parsed.data.tenant) return fail(409)
    const summary = await readSaleSummary(
      ctx.client,
      ctx.active,
      parsed.data.sale,
      ctx.locale,
    )
    if (!summary) return fail(404)
    return saleSummaryPdfResponse(
      await renderSaleSummaryPdf(summary),
      summary.id,
    )
  } catch {
    return fail(503)
  }
}
