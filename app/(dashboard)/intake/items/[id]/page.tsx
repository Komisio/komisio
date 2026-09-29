import Link from 'next/link'
import { ActorSignature } from '@/components/intake/actor-signature'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readItem, formatOre } from '@/lib/engine/items'
import { readItemLabel } from '@/lib/engine/item-label'
import { readPrinters } from '@/lib/engine/printing'
import { PrintJobButton } from '@/components/intake/print-job-button'
import { readChainOverview } from '@/lib/engine/chains'
import { TransferItemForm } from '@/components/intake/transfer-item-form'

export default async function Item({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.guid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.items
  const result = await readItem(ctx.client, active.id, id.data)
  if (!result) notFound()
  const { item, prices, events } = result
  const [printers, label] = await Promise.all([
    readPrinters(ctx.client, active.id),
    readItemLabel(ctx.client, active.id, item.id),
  ])
  const currentPrice = label?.priceOre ?? prices[0]?.price_ore ?? null
  const reference = label?.reference ?? `I-${item.id.slice(0, 8).toUpperCase()}`
  // Transfer targets: other stores in the chain where this person is owner or admin,
  // for a consignment item whose period has not ended. SQL rechecks everything.
  const manages = active.role === 'owner' || active.role === 'admin'
  const chain = manages ? await readChainOverview(ctx.client, active.id) : null
  const transferTargets =
    chain?.stores.filter(
      (s) => s.id !== active.id && (s.role === 'owner' || s.role === 'admin'),
    ) ?? []
  const ended = events.some((e) => e.kind === 'period_ended')
  const t = item.terms
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(ctx.locale), {
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
      <div className="page-heading item-detail-heading">
        <h1>
          {label?.title || `${d.item} ${d.originKinds[item.origin_kind]}`}
        </h1>
        <p className="item-detail-reference">{reference}</p>
        {currentPrice !== null && (
          <p className="item-detail-price">
            <span>{d.currentPrice}</span>
            <strong>
              {formatOre(currentPrice)} {label?.currency ?? currency}
            </strong>
          </p>
        )}
        <div className="item-actor-line">
          <span>
            {d.acceptedAt}: {when(item.accepted_at)} ·{' '}
            {d.ownershipKinds[item.ownership]}
          </span>
          <ActorSignature actor={item.actor} unknown={d.unknownActor} />
        </div>
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
                {all.sellersList.title}
              </Link>
            </>
          )}
        </p>
        {active.role !== 'readonly' && (
          <p className="item-detail-shortcuts">
            <Link
              className="btn btn-secondary"
              href={
                '/intake/lifecycle?' +
                new URLSearchParams({ q: reference }) +
                '#lifecycle-' +
                item.id
              }
            >
              {d.manageSalePeriod}
            </Link>
            <Link
              className="btn btn-secondary"
              href={`/intake/items/${item.id}/label`}
            >
              {all.printing.browserOpen}
            </Link>
          </p>
        )}
      </div>
      <details className="card intake-form item-detail-section">
        <summary>{d.terms}</summary>
        <p>{d.termsHint}</p>
        <dl className="item-detail-facts">
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
      </details>
      {transferTargets.length > 0 &&
        item.ownership === 'consignment' &&
        !ended && (
          <section className="card intake-form">
            <h2>{d.transferHeading}</h2>
            <TransferItemForm
              tenantId={active.id}
              itemId={item.id}
              stores={transferTargets}
              d={d}
              intake={all.intake}
            />
          </section>
        )}
      {active.role !== 'readonly' && printers.some((p) => p.active) && (
        <details className="card intake-form item-detail-section">
          <summary>{d.labelPrinter}</summary>
          <p>{all.printing.itemLabelHint}</p>
          <PrintJobButton
            tenantId={active.id}
            printers={printers}
            kind={prices.length > 1 ? 'markdown' : 'item'}
            referenceKind="item"
            referenceId={item.id}
            d={all.printing}
            intake={all.intake}
            compact
          />
        </details>
      )}
      <details className="card intake-form item-detail-section">
        <summary>
          {d.prices} <span>({prices.length})</span>
        </summary>
        <ul className="item-detail-history">
          {prices.map((p) => (
            <li key={p.id}>
              <div className="item-actor-line">
                <strong>
                  {formatOre(p.price_ore)} {currency}
                </strong>
                <ActorSignature actor={p.actor} unknown={d.unknownActor} />
              </div>
              <span>
                {d.priceReasons[p.reason as keyof typeof d.priceReasons] ??
                  p.reason}
              </span>
              <time dateTime={p.set_at}>{when(p.set_at)}</time>
            </li>
          ))}
        </ul>
      </details>
      <details className="card intake-form item-detail-section">
        <summary>
          {d.events} <span>({events.length})</span>
        </summary>
        <ul className="item-detail-history">
          {events.map((e) => (
            <li key={e.id}>
              <div className="item-actor-line">
                <strong>
                  {d.eventKinds[e.kind as keyof typeof d.eventKinds] ?? e.kind}
                </strong>
                <ActorSignature actor={e.actor} unknown={d.unknownActor} />
              </div>
              <time dateTime={e.occurred_at}>{when(e.occurred_at)}</time>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
