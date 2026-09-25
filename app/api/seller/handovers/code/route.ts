import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { readMySellerAccounts } from '@/lib/engine/seller-portal'
import { readMyHandovers } from '@/lib/engine/handovers'
import { handoverQr } from '@/lib/labels/handover-qr'
const input = z.object({
  tenant: z.uuid(),
  seller: z.uuid(),
  reference: z.string().regex(/^H-[1-9]\d{0,11}$/),
})
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}
/** Read-only, on-demand code for an open handover already visible to this seller. */
export async function GET(request: Request) {
  const fail = (status: number) => new Response(null, { status, headers })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return fail(404)
  const search = new URL(request.url).searchParams
  const parsed = input.safeParse({
    tenant: search.get('tenant'),
    seller: search.get('seller'),
    reference: search.get('reference'),
  })
  if (!parsed.success) return fail(400)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return fail(401)
    const { tenant, seller, reference } = parsed.data
    const accounts = await readMySellerAccounts(ctx.client)
    if (!accounts.some((a) => a.tenantId === tenant && a.sellerId === seller))
      return fail(404)
    const mine = await readMyHandovers(ctx.client, tenant, seller)
    if (
      !mine.handovers.some(
        (h) => h.reference === reference && h.status === 'open',
      )
    )
      return fail(404)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) return fail(503)
    return new Response(handoverQr(reference, appUrl), {
      headers: {
        ...headers,
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return fail(503)
  }
}
