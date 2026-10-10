import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { sellerAgreementState } from '@/lib/engine/seller-agreement'
import {
  renderAgreementPdf,
  agreementPdfResponse,
} from '@/lib/documents/agreement-pdf'

const query = z.object({
  tenant: z.uuid(),
  seller: z.uuid(),
  version: z.uuid(),
  text: z.uuid(),
})
const resultSchema = sellerAgreementState
  .pick({ agreement: true })
  .extend({ storeName: z.string(), sellerName: z.string() })
export const runtime = 'nodejs'

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
    const result = await ctx.client.rpc('my_seller_agreement_document', {
      p_tenant: p.tenant,
      p_seller: p.seller,
      p_version: p.version,
      p_text: p.text,
    })
    if (result.error) return fail(result.error.code === '42501' ? 403 : 404)
    const document = resultSchema.parse(result.data)
    if (!document.agreement) return fail(404)
    const bytes = await renderAgreementPdf({
      ...document,
      agreement: document.agreement,
    })
    return agreementPdfResponse(
      bytes,
      document.agreement.version,
      document.agreement.language,
    )
  } catch {
    return fail(503)
  }
}
