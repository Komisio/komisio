import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { readMySellerStatement } from '@/lib/engine/seller-portal'
import { isLocale } from '@/lib/i18n'
import {
  renderSelfBillingPdf,
  selfBillingPdfResponse,
} from '@/lib/documents/self-billing-pdf'
export const runtime = 'nodejs'
const query = z.object({
  tenant: z.uuid(),
  seller: z.uuid(),
  statement: z.uuid(),
})
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
    if (!ctx || ctx.mfaRequired) return fail(401)
    const p = parsed.data
    const result = await readMySellerStatement(
      ctx.client,
      p.tenant,
      p.seller,
      p.statement,
    )
    if (!result?.header.self_billing) return fail(404)
    const s = result.header
    const locale =
      s.self_billing?.language ??
      (isLocale(s.seller_contact?.language)
        ? s.seller_contact.language
        : ctx.locale)
    return selfBillingPdfResponse(
      await renderSelfBillingPdf(
        { ...s, self_billing: result.header.self_billing },
        locale,
      ),
      s.number,
    )
  } catch {
    return fail(503)
  }
}
