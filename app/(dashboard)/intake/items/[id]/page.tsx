import { ItemHistory } from '@/components/intake/item-history'
import { ItemCollection } from '@/components/intake/item-collection'
import { itemCollectionState } from '@/lib/engine/item-collection'
import { localToday } from '@/lib/engine/overview'
import { currentItemEnd } from '@/lib/engine/item-period'
import { ItemPeriodCorrection } from '@/components/intake/item-period-correction'
import { searchSaleItems } from '@/lib/engine/sale-search'
import { ItemPhotoGallery } from '@/components/intake/item-photo-gallery'
import { ItemDetailWorkspace } from '@/components/intake/item-detail-workspace'
import { ArrowLeft } from 'lucide-react'
import { itemReturnHref, isIntakeReturn } from '@/lib/intake/item-return'
import { readReceptionBagId } from '@/lib/engine/reception-store'
import { readItemDirectory } from '@/lib/engine/item-directory'
import { readAssortmentGroups } from '@/lib/engine/item-classification'
import { readAttributeVocabulary, labelOf } from '@/lib/engine/attributes'
import {
  readItemCategories,
  categoryChoices,
} from '@/lib/engine/item-categories'
import { readItemPhotos } from '@/lib/engine/item-photos'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { ActorSignature } from '@/components/intake/actor-signature'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { EventTime } from '@/components/ui/event-time'
import { readStoreCurrency } from '@/lib/engine/money'
import { readItem, formatOre } from '@/lib/engine/items'
import { readItemLabel } from '@/lib/engine/item-label'
import { readPrinters } from '@/lib/engine/printing'
import { ItemPrintDialog } from '@/components/intake/item-print-dialog'
import { readChainOverview } from '@/lib/engine/chains'
import { TransferItemForm } from '@/components/intake/transfer-item-form'
import { readItemSyncStatus } from '@/lib/engine/item-sync'
import { ItemSyncStatus } from '@/components/intake/item-sync-status'

export default async function Item({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
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
  const bagId =
    item.origin_kind === 'reception_review'
      ? await readReceptionBagId(ctx.client, active.id, item.origin_id)
      : item.custody_kind === 'bag'
        ? item.custody_id
        : null
  const intakeHref = bagId
    ? `/intake/bags/${bagId}/inspect`
    : item.origin_kind === 'reception_review'
      ? `/intake/reception/${item.origin_id}`
      : null
  const backHref = itemReturnHref((await searchParams).returnTo)
  const backToIntake = isIntakeReturn(backHref)
  const backLink = (
    <div className="row wrap item-return-links">
      <Link className="btn btn-secondary item-back-link" href={backHref}>
        <ArrowLeft size={18} aria-hidden="true" />
        {backToIntake ? d.backToIntake : d.backToList}
      </Link>
      {intakeHref && !backToIntake && (
        <Link className="text-link item-back-link" href={intakeHref}>
          {d.backToIntake}
        </Link>
      )}
    </div>
  )
  const [
    printers,
    label,
    photos,
    sync,
    directory,
    groups,
    vocabulary,
    categories,
  ] = await Promise.all([
    readPrinters(ctx.client, active.id),
    readItemLabel(ctx.client, active.id, item.id),
    readItemPhotos(ctx.client, active.id, [item.id]),
    readItemSyncStatus(ctx.client, active.id, [item.id]),
    readItemDirectory(ctx.client, active.id, { q: item.id }, 'title', 'asc', 1),
    readAssortmentGroups(ctx.client, active.id),
    readAttributeVocabulary(ctx.client, active.id),
    readItemCategories(ctx.client, active.id),
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
  const currentEnd = currentItemEnd(events)
  const ended = currentEnd !== null
  const transferred = events.some(
    (e) => e.kind === 'period_ended' && e.detail.action === 'transfer',
  )
  const tomorrow = new Date(`${localToday()}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const t = item.terms
  const originHref =
    item.origin_kind === 'reception_review'
      ? `/intake/reception/${item.origin_id}`
      : item.origin_kind === 'inspection_draft'
        ? `/intake/bags/${String(t.origin.bagId ?? '')}/inspect`
        : `/intake/purchases/${item.origin_id}`
  const snapshot = directory?.items.find((row) => row.id === item.id)
  const collection =
    item.ownership === 'consignment' && snapshot?.stage === 'ended'
      ? itemCollectionState(events)
      : null
  // Use one consistent directory snapshot for the optimistic edit preconditions.
  if (!snapshot)
    return (
      <>
        {backLink}
        <h1>{label?.title || d.item}</h1>
        <p role="status">{all.itemWorkflow.reload}</p>
      </>
    )
  return (
    <>
      {backLink}
      <ItemDetailWorkspace
        markSoldHref={
          active.role !== 'readonly' &&
          (await searchSaleItems(ctx.client, active.id, item.id)).some(
            (row) => row.id === item.id,
          )
            ? `/intake/sales?item=${item.id}#sales-manual`
            : undefined
        }
        item={snapshot}
        tenantId={active.id}
        write={['owner', 'admin', 'staff'].includes(active.role)}
        types={vocabulary.types
          .filter(
            (type) =>
              type.active || type.slug === snapshot.classification?.itemType,
          )
          .map((type) => ({
            id: type.slug,
            name: labelOf(type, ctx.locale),
          }))}
        groups={groups}
        categories={categoryChoices(categories, ctx.locale)}
        d={all}
        locale={ctx.locale}
        reference={reference}
        saleHref={
          '/intake/lifecycle?' +
          new URLSearchParams({ q: reference }) +
          '#lifecycle-' +
          item.id
        }
        price={
          currentPrice !== null ? (
            <p className="item-detail-price">
              <span>{d.currentPrice}</span>
              <strong>
                {formatOre(currentPrice)} {label?.currency ?? currency}
              </strong>
            </p>
          ) : null
        }
        metadata={
          <>
            {currentEnd &&
              snapshot.stage === 'ended' &&
              !transferred &&
              ['owner', 'admin', 'staff'].includes(active.role) && (
                <ItemPeriodCorrection
                  tenantId={active.id}
                  itemId={item.id}
                  endEventId={currentEnd.id}
                  tomorrow={tomorrow.toISOString().slice(0, 10)}
                  d={all.itemPeriod}
                  intake={all.intake}
                  actions={d.eventDetails.actions}
                />
              )}
            {collection && (
              <ItemCollection
                tenantId={active.id}
                itemId={item.id}
                state={collection}
                write={['owner', 'admin', 'staff'].includes(active.role)}
                today={localToday()}
                locale={ctx.locale}
                d={all.itemCollection}
                intake={all.intake}
              />
            )}
            <div className="item-actor-line">
              <span>
                {d.acceptedAt}:{' '}
                <EventTime value={item.accepted_at} locale={ctx.locale} />
              </span>
              <ActorSignature actor={item.actor} unknown={d.unknownActor} />
            </div>
            <p className="item-origin-link">
              <Link className="text-link" href={originHref}>
                {d.openOrigin}
              </Link>
            </p>
          </>
        }
        printing={
          <>
            <Link
              className="btn btn-secondary"
              href={`/intake/items/${item.id}/label`}
            >
              {all.printing.browserOpen}
            </Link>
            <Link
              className="btn btn-secondary"
              href={`/intake/items/labels?item=${item.id}`}
            >
              {all.labelSheets.title}
            </Link>
            <ItemPrintDialog
              tenantId={active.id}
              itemId={item.id}
              printers={printers}
              kind={prices.length > 1 ? 'markdown' : 'item'}
              manage={manages}
              d={all.printing}
              intake={all.intake}
            />
          </>
        }
        photos={
          <>
            {photos[0] && (
              <ItemPhotoGallery
                key={item.id}
                tenantId={active.id}
                initial={photos[0]}
                title={label?.title || d.item}
                write={['owner', 'admin', 'staff'].includes(active.role)}
                d={all.itemPhotos}
              />
            )}
          </>
        }
        sync={
          <>
            {sync?.[0] && (
              <div id="sync-status">
                <ItemSyncStatus
                  connections={sync[0].connections}
                  tenantId={active.id}
                  manage={manages}
                  locale={ctx.locale}
                  d={all}
                />
              </div>
            )}
          </>
        }
        terms={
          <>
            <details className="card intake-form item-detail-section">
              <summary>{d.terms}</summary>
              <p>{d.termsHint}</p>
              <dl className="item-detail-facts">
                {item.ownership === 'consignment' ? (
                  <div>
                    <dt>{d.commission}</dt>
                    <dd>
                      {t.commissionRatePercent} % ·{' '}
                      {t.commissionBasis
                        ? all.sellerTerms[t.commissionBasis]
                        : ''}
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
                    {item.custody_kind
                      ? d.custodyKinds[item.custody_kind]
                      : '—'}
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
          </>
        }
        history={
          <ItemHistory
            prices={prices}
            events={events}
            currency={currency}
            locale={ctx.locale}
            d={d}
          />
        }
      />
    </>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.items.item)
