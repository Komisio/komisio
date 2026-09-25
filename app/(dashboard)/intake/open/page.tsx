import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'

/** Scan-to-open (P1 S8): a bag label K-n opens the bag, a garment label G-n opens the reception, a handover H-n opens the handover queue. */
export default async function OpenByReference({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    tenant = ctx.active!,
    d = dictionary(ctx.locale).openByReference
  const raw = (await searchParams).ref
  const ref = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  const match = /^([KGH])-?(\d{1,12})$/.exec(ref)
  if (match) {
    const number = Number(match[2])
    if (match[1] === 'H') {
      const handover = await ctx.client
        .from('seller_handovers')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('reference', number)
        .maybeSingle()
      if (handover.data) redirect(`/intake/handovers?focus=${handover.data.id}`)
    } else if (match[1] === 'K') {
      const bag = await ctx.client
        .from('bag_receipts')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('reference', number)
        .maybeSingle()
      if (bag.data) redirect(`/intake/bags/${bag.data.id}/inspect`)
    } else {
      const garment = await ctx.client
        .from('garment_receipts')
        .select('session_id')
        .eq('tenant_id', tenant.id)
        .eq('reference', number)
        .maybeSingle()
      if (garment.data) redirect(`/intake/reception/${garment.data.session_id}`)
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <section className="card intake-form">
        {ref && <p role="alert">{d.notFound.replace('{ref}', ref)}</p>}
        <form action="/intake/open">
          <div className="field">
            <label htmlFor="open-ref">{d.reference}</label>
            <input
              id="open-ref"
              name="ref"
              autoFocus
              inputMode="text"
              placeholder="K-12"
              defaultValue={ref}
              maxLength={16}
            />
            <small>{d.hint}</small>
          </div>
          <button className="btn">{d.open}</button>
        </form>
        <Link className="text-link" href="/intake">
          {dictionary(ctx.locale).intake.back}
        </Link>
      </section>
    </>
  )
}
