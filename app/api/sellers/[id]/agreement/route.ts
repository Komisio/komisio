import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'

/** Current terms and evidence for one explicitly selected seller. No contact export. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active) return reply({}, 401)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({}, 403)
    if (new URL(request.url).searchParams.get('tenant') !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return reply({}, 400)
    const seller = await ctx.client
      .from('sellers')
      .select('id')
      .eq('tenant_id', ctx.active.id)
      .eq('id', id.data)
      .maybeSingle()
    if (seller.error) return reply({}, 503)
    if (!seller.data) return reply({}, 404)
    const agreement = await ctx.client
      .from('seller_agreement_versions')
      .select(
        'id,title,version,language,translations:seller_agreement_translations(id,title,language)',
      )
      .eq('tenant_id', ctx.active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (agreement.error) return reply({}, 503)
    const evidence = agreement.data
      ? await ctx.client
          .from('seller_agreement_evidence')
          .select('id')
          .eq('tenant_id', ctx.active.id)
          .eq('seller_id', id.data)
          .eq('agreement_id', agreement.data.id)
          .limit(1)
      : { data: [], error: null }
    if (evidence.error) return reply({}, 503)
    return reply({
      agreement: agreement.data,
      accepted: Boolean(evidence.data?.length),
    })
  } catch {
    return reply({}, 500)
  }
}
