import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { PrintLabel } from '@/components/intake/print-label'

export default async function BagLabel({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const { data: bag, error } = await ctx.client
    .from('bag_receipts')
    .select('reference,received_at')
    .eq('tenant_id', ctx.active!.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Unable to load bag label')
  if (!bag) notFound()
  const d = dictionary(ctx.locale).intake
  return (
    <>
      <div className="page-heading no-print">
        <h1>{d.label}</h1>
        <p>{d.pilot}</p>
      </div>
      <article className="bag-label">
        <strong>{ctx.active!.name}</strong>
        <h2>
          {d.bag} K-{bag.reference}
        </h2>
        <p>
          {d.receivedAt}:{' '}
          {new Date(bag.received_at).toLocaleDateString(
            ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
            { timeZone: 'Europe/Stockholm' },
          )}
        </p>
        <p>{d.awaiting}</p>
      </article>
      <div className="row no-print">
        <PrintLabel label={d.print} />
        <Link className="text-link" href="/intake">
          {d.back}
        </Link>
      </div>
    </>
  )
}
