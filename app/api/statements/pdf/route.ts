import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { readStatement } from '@/lib/engine/statements'
import { isLocale } from '@/lib/i18n'
import {
  renderSelfBillingPdf,
  selfBillingPdfResponse,
} from '@/lib/documents/self-billing-pdf'
export const runtime = 'nodejs'
const query = z.object({ tenant: z.uuid(), statement: z.uuid() })
export async function GET(request: Request) {
  const fail = (status: number) =>
    new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return fail(404)
  const parsed = query.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return fail(400)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active) return fail(401)
    if (!['owner', 'admin', 'staff', 'readonly'].includes(ctx.active.role))
      return fail(403)
    if (ctx.active.id !== parsed.data.tenant) return fail(409)
    const result = await readStatement(
      ctx.client,
      parsed.data.tenant,
      parsed.data.statement,
    )
    if (!result?.statement.self_billing) return fail(404)
    const s = result.statement
    const locale =
      s.self_billing?.language ??
      (isLocale(s.seller_contact?.language)
        ? s.seller_contact.language
        : ctx.locale)
    return selfBillingPdfResponse(
      await renderSelfBillingPdf(
        { ...s, self_billing: result.statement.self_billing },
        locale,
      ),
      s.number,
    )
  } catch {
    return fail(503)
  }
}
