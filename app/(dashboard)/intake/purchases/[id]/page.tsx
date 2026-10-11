import { z } from 'zod'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary } from '@/lib/i18n'
import { readPurchaseReceipt } from '@/lib/engine/purchases'
import { readStoreCurrency } from '@/lib/engine/money'
import { readItemsForOrigins, formatOre } from '@/lib/engine/items'
import { EventTime } from '@/components/ui/event-time'

export default async function PurchaseReceipt({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.purchases
  const receipt = await readPurchaseReceipt(ctx.client, active.id, id.data)
  if (!receipt) notFound()
  const [currency, items] = await Promise.all([
    readStoreCurrency(ctx.client, active.id),
    readItemsForOrigins(ctx.client, active.id, 'purchase', [receipt.id]),
  ])
  const item = items.get(receipt.id)
  return (
    <>
      <div className="page-heading workspace-heading">
        <h1>
          {d.reference} P-{receipt.reference}
        </h1>
        <Link className="text-link" href="/intake/purchases#purchases-history">
          {d.history}
        </Link>
      </div>
      <section className="card intake-form purchase-receipt">
        {receipt.supplier_note && <p>{receipt.supplier_note}</p>}
        <dl className="item-detail-facts">
          <div>
            <dt>{d.price}</dt>
            <dd>
              {formatOre(receipt.purchase_price_ore)} {currency}
            </dd>
          </div>
          <div>
            <dt>{d.purchasedAt}</dt>
            <dd>
              <EventTime value={receipt.purchased_at} locale={ctx.locale} />
            </dd>
          </div>
          <div>
            <dt>{d.evidence}</dt>
            <dd>{receipt.evidence_reference}</dd>
          </div>
        </dl>
        <p>{receipt.margin_eligible ? d.marginYes : d.marginNo}</p>
        {item && (
          <Link className="btn btn-secondary" href={`/intake/items/${item.id}`}>
            {all.items.open}
          </Link>
        )}
      </section>
    </>
  )
}
export const generateMetadata = () =>
  platformPageMetadata((d) => d.purchases.title)
