import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readItem, formatOre } from '@/lib/engine/items'
import { readPrinters } from '@/lib/engine/printing'
import { PrintJobButton } from '@/components/intake/print-job-button'

export default async function Item({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.items
  const result = await readItem(ctx.client, active.id, id.data)
  if (!result) notFound()
  const { item, prices, events } = result
  const printers = await readPrinters(ctx.client, active.id)
  const t = item.terms
  const when = (iso: string) =>
    new Date(iso).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  const originHref =
    item.origin_kind === 'reception_review'
      ? `/intake/reception/${item.origin_id}`
      : item.origin_kind === 'inspection_draft'
        ? `/intake/bags/${String(t.origin.bagId ?? '')}/inspect?draft=${item.origin_id}`
        : '/intake/purchases'
  return (
    <>
      <Link className="text-link" href="/intake/items">
        {d.backToList}
      </Link>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>
          {d.item} {d.originKinds[item.origin_kind]}
        </h1>
        <p>
          {d.acceptedAt}: {when(item.accepted_at)} ·{' '}
          {d.ownershipKinds[item.ownership]}
        </p>
        <p>
          <Link className="text-link" href={originHref}>
            {d.openOrigin}
          </Link>
          {item.seller_id && (
            <>
              {' · '}
              <Link
                className="text-link"
                href={`/intake/sellers/${item.seller_id}`}
              >
                {all.sellerTerms.title}
              </Link>
            </>
          )}
        </p>
      </div>
      <section className="card intake-form">
        <h2>{d.terms}</h2>
        <p>{d.termsHint}</p>
        <dl>
          {item.ownership === 'consignment' ? (
            <div>
              <dt>{d.commission}</dt>
              <dd>
                {t.commissionRatePercent} % ·{' '}
                {t.commissionBasis ? all.sellerTerms[t.commissionBasis] : ''}
              </dd>
            </div>
          ) : (
            <div>
              <dt>{d.purchasePrice}</dt>
              <dd>
                {t.purchasePriceOre !== undefined
                  ? `${formatOre(t.purchasePriceOre)} ${currency}`
                  : '—'}{' '}
                ·{' '}
                {t.marginEligible
                  ? all.purchases.marginYes
                  : all.purchases.marginNo}
              </dd>
            </div>
          )}
          <div>
            <dt>{d.salePeriod}</dt>
            <dd>
              {t.salePeriodDays} {d.days} ·{' '}
              {all.storePolicy[t.endOfPeriodAction]}
            </dd>
          </div>
          <div>
            <dt>{d.evidence}</dt>
            <dd>{d.evidenceKinds[t.evidenceKind]}</dd>
          </div>
          <div>
            <dt>{d.custody}</dt>
            <dd>
              {item.custody_kind ? d.custodyKinds[item.custody_kind] : '—'}
            </dd>
          </div>
          <div>
            <dt>{all.storePolicy.version}</dt>
            <dd>{t.storePolicyVersion}</dd>
          </div>
        </dl>
      </section>
      {active.role !== 'readonly' && (
        <section className="card intake-form">
          <h2>{all.printing.itemLabel}</h2>
          <p>{all.printing.itemLabelHint}</p>
          <PrintJobButton
            tenantId={active.id}
            printers={printers}
            kind={prices.length > 1 ? 'markdown' : 'item'}
            referenceKind="item"
            referenceId={item.id}
            d={all.printing}
            intake={all.intake}
          />
        </section>
      )}
      <section className="card intake-form">
        <h2>{d.prices}</h2>
        {prices.map((p) => (
          <p key={p.id}>
            {formatOre(p.price_ore)} {currency} ·{' '}
            {d.priceReasons[p.reason as keyof typeof d.priceReasons] ??
              p.reason}{' '}
            · {when(p.set_at)}
          </p>
        ))}
      </section>
      <section className="card intake-form">
        <h2>{d.events}</h2>
        {events.map((e) => (
          <p key={e.id}>
            {d.eventKinds[e.kind as keyof typeof d.eventKinds] ?? e.kind} ·{' '}
            {when(e.occurred_at)}
          </p>
        ))}
      </section>
    </>
  )
}
