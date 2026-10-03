import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { NavigationLink } from '@/components/platform/navigation-warning'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { PurchaseForm } from '@/components/intake/purchase-form'
import { AcceptItemForm } from '@/components/intake/accept-item-form'
import { readItemsForOrigins } from '@/lib/engine/items'

const row = z.object({
  id: z.uuid(),
  reference: z.union([z.number().int(), z.string()]),
  supplier_note: z.string(),
  purchase_price_ore: z.union([z.number().int(), z.string()]),
  evidence_reference: z.string(),
  margin_eligible: z.boolean(),
  purchased_at: z.iso.datetime({ offset: true }),
})
function formatOre(value: number | string) {
  const ore = BigInt(value)
  const kronor = ore / 100n,
    rest = ore % 100n
  return `${kronor}.${rest.toString().padStart(2, '0')}`
}

export default async function Purchases({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.purchases
  const params = await searchParams
  const pageSize = 20
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const href = (page: number) =>
    '/intake/purchases' + (page > 1 ? '?page=' + page : '') + '#purchase-list'
  // Count within the active store before reading a range, so an oversized
  // page can be redirected without issuing an out-of-range database request.
  const totals = await ctx.client
    .from('purchase_receipts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', active.id)
  if (totals.error || totals.count === null)
    throw new Error('Unable to count purchases')
  const pages = Math.max(1, Math.ceil(totals.count / pageSize))
  if (requestedPage > pages) redirect(href(pages))
  const offset = (requestedPage - 1) * pageSize
  const { data, error } = await ctx.client
    .from('purchase_receipts')
    .select(
      'id,reference,supplier_note,purchase_price_ore,evidence_reference,margin_eligible,purchased_at',
    )
    .eq('tenant_id', active.id)
    .order('purchased_at', { ascending: false })
    .order('id')
    .range(offset, offset + pageSize - 1)
  if (error) throw new Error('Unable to load purchases')
  const purchases = z
    .array(row)
    .max(pageSize)
    .parse(data ?? [])
  const accepted = await readItemsForOrigins(
    ctx.client,
    active.id,
    'purchase',
    purchases.map((p) => p.id),
  )
  const common = all.sellersList
  const pager =
    pages > 1 ? (
      <nav className="seller-directory-pagination" aria-label={d.title}>
        {requestedPage > 1 && (
          <Link className="btn btn-secondary" href={href(requestedPage - 1)}>
            {common.previousPage}
          </Link>
        )}
        <span>
          {common.pageOf
            .replace('{page}', String(requestedPage))
            .replace('{pages}', String(pages))}
        </span>
        {requestedPage < pages && (
          <Link className="btn btn-secondary" href={href(requestedPage + 1)}>
            {common.nextPage}
          </Link>
        )}
      </nav>
    ) : null
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <p className="intake-notice">
        {d.notice.replace('{accept}', all.items.accept)}
      </p>
      <div className="purchases-workspace">
        {active.role !== 'readonly' ? (
          <details className="card purchase-create">
            <summary>{d.registerHeading}</summary>
            <PurchaseForm
              key={active.id}
              tenantId={active.id}
              d={d}
              intake={all.intake}
              leaveUnsaved={all.leaveUnsaved}
            />
          </details>
        ) : (
          <p>{all.intake.readOnly}</p>
        )}
        <section className="card intake-form" id="purchase-list">
          <h2>{d.recent}</h2>
          <p>{d.recentHint}</p>
          {pager}
          <ul className="intake-list">
            {purchases.map((p) => (
              <li key={p.id} className="intake-bag purchase-entry">
                <div>
                  <div className="purchase-entry-heading">
                    <strong>
                      {d.reference} P-{p.reference}
                    </strong>
                    <span>
                      {formatOre(p.purchase_price_ore)} {currency}
                    </span>
                  </div>
                  {p.supplier_note && <p>{p.supplier_note}</p>}
                  <small>
                    {new Date(p.purchased_at).toLocaleString(
                      intlLocale(ctx.locale),
                      {
                        timeZone: 'Europe/Stockholm',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      },
                    )}{' '}
                  </small>
                  <details className="purchase-evidence">
                    <summary>{d.evidence}</summary>
                    <p>{p.evidence_reference}</p>
                    <p>{p.margin_eligible ? d.marginYes : d.marginNo}</p>
                  </details>
                  {accepted.has(p.id) ? (
                    <p>
                      <NavigationLink
                        className="text-link"
                        href={`/intake/items/${accepted.get(p.id)!.id}`}
                      >
                        {all.items.alreadyAccepted} {all.items.open}
                      </NavigationLink>
                    </p>
                  ) : active.role !== 'readonly' ? (
                    <details className="purchase-accept">
                      <summary>{all.items.accept}</summary>
                      <AcceptItemForm
                        tenantId={active.id}
                        originKind="purchase"
                        originId={p.id}
                        originRevision={null}
                        d={all.items}
                        intake={all.intake}
                      />
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {!purchases.length && <p>{d.empty}</p>}
          {pager}
        </section>
      </div>
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.purchases.title)
