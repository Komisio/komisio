import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readApprovedPayoutsPage } from '@/lib/engine/payouts'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { PaymentSheetRows } from '@/components/intake/payment-sheet-rows'
import { PrintLabel } from '@/components/intake/print-label'
import { PaymentSheetDownload } from '@/components/intake/payment-sheet-download'

export default async function PaymentSheet({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const query = await searchParams
  const parsed = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .safeParse(query.page ?? 1)
  if (!parsed.success) notFound()
  const page = parsed.data
  const ctx = await requirePlatform(),
    active = ctx.active!
  const all = dictionary(ctx.locale),
    d = all.payoutSheet
  const [result, currency] = await Promise.all([
    readApprovedPayoutsPage(ctx.client, active.id, page),
    readStoreCurrency(ctx.client, active.id),
  ])
  const pages = Math.max(1, Math.ceil(result.count / 50))
  if (page > pages) redirect(`/intake/payouts/payment-sheet?page=${pages}`)
  const names = new Map<string, string>()
  if (result.rows.length) {
    const sellers = await ctx.client
      .from('sellers')
      .select('id,name')
      .eq('tenant_id', active.id)
      .in('id', [...new Set(result.rows.map((r) => r.seller_id))])
    if (sellers.error) throw new Error('Unable to read sellers')
    for (const seller of z
      .array(z.object({ id: z.uuid(), name: z.string() }))
      .parse(sellers.data))
      names.set(seller.id, seller.name)
  }
  const rows = result.rows.map((r) => {
    const seller = names.get(r.seller_id)
    if (seller === undefined) throw new Error('Unable to read payout seller')
    return { id: r.id, seller, amountOre: r.amount_ore }
  })
  const total = rows.reduce((sum, row) => sum + row.amountOre, 0)
  if (!Number.isSafeInteger(total)) throw new Error('Invalid payout total')
  const generatedAt = new Date().toISOString()
  const sheet = { store: active.name, generatedAt, page, currency, rows }
  return (
    <article className="payment-sheet">
      <Link href="/intake/payouts" className="text-link no-print">
        {all.payouts.title}
      </Link>
      <header className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.hint}</p>
      </header>
      <section className="card intake-form">
        <h2>{active.name}</h2>
        <p>
          {d.snapshot}:{' '}
          {new Date(generatedAt).toLocaleString(intlLocale(ctx.locale), {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          })}
          {' UTC'}
        </p>
        <p>
          {d.page
            .replace('{page}', String(page))
            .replace('{pages}', String(pages))}{' '}
          · {d.count.replace('{count}', String(result.count))}
        </p>
        {rows.length > 0 ? (
          <>
            <p>
              <strong>
                {d.total}: {formatSignedOre(total)} {currency}
              </strong>
            </p>
            <div className="form-actions no-print">
              <PrintLabel label={d.print} />
              <PaymentSheetDownload
                sheet={sheet}
                headings={[
                  d.store,
                  d.snapshot,
                  d.pageColumn,
                  d.reference,
                  all.payouts.seller,
                  all.payouts.amount,
                  d.currency,
                ]}
                label={d.download}
              />
            </div>
            <PaymentSheetRows
              key={`${active.id}:${page}`}
              tenantId={active.id}
              currency={currency}
              rows={rows}
              editable={active.role !== 'readonly'}
              d={d}
              payouts={all.payouts}
              intake={all.intake}
              unsavedMessage={all.inspection.unsaved}
            />
          </>
        ) : (
          <p role="status">{d.empty}</p>
        )}
      </section>
      <nav className="form-actions no-print" aria-label={d.navigation}>
        {page > 1 && (
          <Link className="text-link" href={`?page=${page - 1}`}>
            {d.previous}
          </Link>
        )}
        {page < pages && (
          <Link className="text-link" href={`?page=${page + 1}`}>
            {d.next}
          </Link>
        )}
      </nav>
    </article>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.payoutSheet.title)
