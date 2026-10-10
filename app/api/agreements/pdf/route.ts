import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { locales } from '@/lib/i18n'
import {
  renderAgreementPdf,
  agreementPdfResponse,
} from '@/lib/documents/agreement-pdf'

const query = z.object({
  tenant: z.uuid(),
  version: z.uuid(),
  seller: z.uuid().optional(),
  text: z.uuid().optional(),
})
const textSchema = z.object({
  title: z.string(),
  body: z.string(),
  language: z.enum(locales),
})
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
    if (!ctx || ctx.mfaRequired || !ctx.active) return fail(401)
    if (!['owner', 'admin', 'staff', 'readonly'].includes(ctx.active.role))
      return fail(403)
    const p = parsed.data
    if (ctx.active.id !== p.tenant) return fail(409)
    const [version, seller] = await Promise.all([
      ctx.client
        .from('seller_agreement_versions')
        .select('id,version,title,body,language')
        .eq('tenant_id', p.tenant)
        .eq('id', p.version)
        .maybeSingle(),
      p.seller
        ? ctx.client
            .from('sellers')
            .select('name')
            .eq('tenant_id', p.tenant)
            .eq('id', p.seller)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (version.error || seller.error) return fail(503)
    if (!version.data || (p.seller && !seller.data)) return fail(404)
    let text = version.data
    if (p.text && p.text !== p.version) {
      const translation = await ctx.client
        .from('seller_agreement_translations')
        .select('title,body,language')
        .eq('tenant_id', p.tenant)
        .eq('agreement_id', p.version)
        .eq('id', p.text)
        .maybeSingle()
      if (translation.error) return fail(503)
      if (!translation.data) return fail(404)
      text = { ...version.data, ...translation.data }
    }
    const agreement = {
      id: p.version,
      version: z.number().int().positive().parse(version.data.version),
      ...textSchema.parse(text),
    }
    const bytes = await renderAgreementPdf({
      agreement,
      storeName: ctx.active.name,
      sellerName: seller.data?.name,
    })
    return agreementPdfResponse(bytes, agreement.version, agreement.language)
  } catch {
    return fail(503)
  }
}
