import { CompactDirectory } from '@/components/ui/compact-directory'
import { WorkingForm } from '@/components/platform/working-form'
import { ScanFocusInput } from '@/components/platform/scan-focus'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { SellerSearchStep } from '@/components/intake/seller-search-step'
import { SellerSearch } from '@/components/intake/seller-search'
import { readStorePolicy } from '@/lib/engine/store-policy'
import Link from '@/components/platform/working-link'
import { notFound, redirect } from 'next/navigation'
import { readSellersOverviewPage } from '@/lib/engine/sellers'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, localeNames, resolveLocale } from '@/lib/i18n'
import type {
  Seller,
  SellerAgreement,
  AgreementEvidence,
} from '@/lib/engine/intake'
import { ReceivingPanel } from '@/components/intake/receiving-panel'
import {
  bagQueueNavigation,
  bagQueueHref,
  readBagQueue,
} from '@/lib/engine/bag-queue'
import { EvidenceRecorder } from '@/components/intake/agreement-forms'

export default async function Intake({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const policy = await readStorePolicy(ctx.client, active.id)
  const all = dictionary(ctx.locale)
  const d = all.intake
  const a = all.agreements
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const sellerPage =
    typeof params.sellerPage === 'string' &&
    /^[1-9]\d{0,6}$/.test(params.sellerPage)
      ? Number(params.sellerPage)
      : 1
  const sellerPageHref = (page: number) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params))
      if (typeof value === 'string' && key !== 'sellerPage' && key !== 'q')
        search.set(key, value)
    if (q) search.set('q', q)
    if (page > 1) search.set('sellerPage', String(page))
    return '/intake' + (search.size ? '?' + search : '') + '#seller-search'
  }
  const navigation = bagQueueNavigation.safeParse(params)
  if (!navigation.success) notFound()
  const filters = navigation.data
  const selectedId = z.uuid().safeParse(filters.seller)
  const [sellers, bags, selected, agreementResult] = await Promise.all([
    readSellersOverviewPage(
      ctx.client,
      active.id,
      q,
      (sellerPage - 1) * 12,
      12,
    ),
    readBagQueue(ctx.client, active.id, params),
    selectedId.success
      ? ctx.client
          .from('sellers')
          .select('id,name,email,phone')
          .eq('tenant_id', active.id)
          .eq('id', selectedId.data)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ctx.client
      .from('seller_agreement_versions')
      .select('*,translations:seller_agreement_translations(id,title,language)')
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!sellers || selected.error || agreementResult.error)
    throw new Error('Unable to load intake')
  const sellerPages = Math.max(1, Math.ceil(sellers.total / 12))
  if (sellerPage > sellerPages) redirect(sellerPageHref(sellerPages))
  const agreement = agreementResult.data as SellerAgreement | null
  const evidenceResult =
    agreement && selected.data
      ? await ctx.client
          .from('seller_agreement_evidence')
          .select('id,agreement_id,reference,recorded_at,translation_id,source')
          .eq('tenant_id', active.id)
          .eq('agreement_id', agreement.id)
          .eq('seller_id', selected.data.id)
          .order('recorded_at', { ascending: false })
          .order('id')
          .limit(1)
          .maybeSingle()
      : { data: null, error: null }
  if (evidenceResult.error) throw new Error('Unable to load agreement evidence')
  const evidence = evidenceResult.data as AgreementEvidence | null
  const receivingPanel = (
    <ReceivingPanel
      key={`${active.id}:${selected.data?.id ?? 'new'}`}
      tenantId={active.id}
      seller={selected.data as Seller | null}
      d={d}
      details={all.sellerDetails}
      changeSellerLabel={all.quickIntake.changeSeller}
      expectedAgreementId={agreement?.id ?? null}
      agreement={agreement}
      agreements={all.agreements}
      agreementBlocked={Boolean(
        selected.data &&
        (agreement?.required_before_receipt ||
          policy.policy.agreementRequiredFor.includes('bag_receipt')) &&
        !evidence,
      )}
    />
  )
  return (
    <div className="intake-overview">
      <div className="page-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{ label: d.overviewHelpLabel, steps: [d.intro] }}
        />
      </div>
      <nav className="intake-paths intake-shortcuts" aria-label={d.title}>
        {process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED === 'true' && (
          <Link className="text-link" href="/intake/submissions">
            {all.submissions.queue}
          </Link>
        )}
        <Link className="text-link" href="/intake/quick">
          {all.quickIntake.title} <span aria-hidden="true">→</span>
        </Link>
      </nav>
      <WorkspaceTabs
        id="intake"
        label={d.title}
        initial={
          filters.state || filters.bag || filters.older || filters.newer
            ? 'queue'
            : 'receive'
        }
        tabs={[
          {
            id: 'receive',
            label: all.nav.receiveBag,
            anchors: ['bag-receiving', 'seller-search', 'new-seller'],
            content: (
              <div className="intake-grid" id="bag-receiving">
                <SellerSearchStep
                  key={active.id}
                  cancelLabel={all.cancel}
                  registration={
                    !selected.data && active.role !== 'readonly'
                      ? {
                          tenantId: active.id,
                          seller: null,
                          d,
                          details: all.sellerDetails,
                          changeSellerLabel: all.quickIntake.changeSeller,
                          agreement,
                          agreements: all.agreements,
                        }
                      : null
                  }
                >
                  <section
                    className="card intake-form intake-find-seller"
                    aria-labelledby="seller-search-heading"
                  >
                    <h2 id="seller-search-heading">{d.find}</h2>
                    <div className="intake-search-actions">
                      <SellerSearch>
                        <label htmlFor="seller-search" className="sr-only">
                          {all.sellersList.search}
                        </label>
                        <div className="row">
                          <ScanFocusInput
                            focusLabel={all.scanFocus}
                            contextLabel={d.title}
                            id="seller-search"
                            type="search"
                            placeholder={all.sellersList.searchHint}
                            name="q"
                            defaultValue={q}
                            maxLength={120}
                          />
                          <noscript>
                            <button className="btn btn-secondary">
                              {d.searchButton}
                            </button>
                          </noscript>
                        </div>
                      </SellerSearch>
                      {active.role !== 'readonly' && (
                        <Link
                          className="btn btn-secondary"
                          href={`/intake${q ? '?q=' + encodeURIComponent(q) : ''}#new-seller`}
                        >
                          {d.newSellerAction}
                        </Link>
                      )}
                    </div>
                    {q && (
                      <p>
                        <Link
                          className="text-link"
                          href="/intake#seller-search"
                        >
                          {all.sellersList.clear}
                        </Link>
                      </p>
                    )}
                    {sellers.total > 0 && (
                      <p>
                        <small>
                          {all.sellersList.showingRange
                            .replace('{from}', String(sellers.offset + 1))
                            .replace(
                              '{to}',
                              String(sellers.offset + sellers.sellers.length),
                            )
                            .replace('{total}', String(sellers.total))}
                        </small>
                      </p>
                    )}
                    <ul className="intake-list intake-seller-results">
                      {sellers.sellers.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/intake?seller=${s.id}#new-seller`}
                            className="intake-seller"
                            aria-current={
                              selected.data?.id === s.id ? 'true' : undefined
                            }
                          >
                            <strong title={s.name}>{s.name}</strong>
                            <small title={s.email || s.phone || undefined}>
                              {s.email || s.phone}
                            </small>
                            <span>{d.choose}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {sellers.sellers.length === 0 && <p>{d.noSellers}</p>}
                    {sellerPages > 1 && (
                      <nav
                        className="row wrap"
                        aria-label={all.sellersList.title}
                      >
                        {sellerPage > 1 && (
                          <Link
                            className="btn btn-secondary"
                            href={sellerPageHref(sellerPage - 1)}
                          >
                            {all.sellersList.previousPage}
                          </Link>
                        )}
                        {sellerPage < sellerPages && (
                          <Link
                            className="btn btn-secondary"
                            href={sellerPageHref(sellerPage + 1)}
                          >
                            {all.sellersList.nextPage}
                          </Link>
                        )}
                      </nav>
                    )}
                  </section>
                </SellerSearchStep>
                {selected.data && (
                  <div id="new-seller">
                    {agreement && (
                      <details
                        className="card intake-form agreement-at-intake"
                        open={Boolean(
                          !evidence &&
                          (agreement.required_before_receipt ||
                            policy.policy.agreementRequiredFor.includes(
                              'bag_receipt',
                            )),
                        )}
                      >
                        <summary>{a.evidenceHeading}</summary>
                        <p>
                          <strong>
                            {agreement.title} · {a.version} {agreement.version}
                          </strong>
                          <br />
                          {a.language}:{' '}
                          {
                            localeNames[
                              resolveLocale(undefined, agreement.language)
                            ]
                          }
                        </p>
                        <p>
                          {agreement.required_before_receipt
                            ? a.required
                            : a.optional}
                        </p>
                        <details>
                          <summary>{a.view}</summary>
                          <div
                            className="agreement-text"
                            lang={intlLocale(agreement.language)}
                          >
                            {agreement.body}
                          </div>
                        </details>
                        <p>{evidence ? a.available : a.missing}</p>
                        {evidence ? (
                          <p>
                            {evidence.source === 'seller_portal'
                              ? all.sellerAgreement.accepted
                              : a.staffRecorded}
                            :{' '}
                            {new Date(evidence.recorded_at).toLocaleString(
                              intlLocale(ctx.locale),
                              { timeZone: 'Europe/Stockholm' },
                            )}
                            <br />
                            {evidence.reference} ·{' '}
                            {
                              localeNames[
                                agreement.translations?.find(
                                  (t) => t.id === evidence.translation_id,
                                )?.language ?? agreement.language
                              ]
                            }
                          </p>
                        ) : (
                          active.role !== 'readonly' && (
                            <EvidenceRecorder
                              key={`${active.id}:${selected.data.id}:${agreement.id}`}
                              tenantId={active.id}
                              sellerId={selected.data.id}
                              agreementId={agreement.id}
                              agreement={agreement}
                              d={all}
                            />
                          )
                        )}
                      </details>
                    )}
                    {active.role !== 'readonly' ? (
                      receivingPanel
                    ) : (
                      <p>{d.readOnly}</p>
                    )}
                  </div>
                )}
              </div>
            ),
          },
          {
            id: 'queue',
            label: d.queue,
            anchors: ['bag-queue'],
            content: (
              <section
                className="card intake-form received-bags"
                id="bag-queue"
              >
                {filters.state === 'unstarted' && (
                  <p>{all.storeFlow.live.dropoffHelp}</p>
                )}
                {selected.data && (
                  <p>
                    {d.bagsFor}: <strong>{selected.data.name}</strong>
                  </p>
                )}
                <WorkingForm
                  action="/intake#bag-queue"
                  className="field received-bags-search"
                >
                  {filters.state && (
                    <input type="hidden" name="state" value={filters.state} />
                  )}
                  {filters.seller && (
                    <input type="hidden" name="seller" value={filters.seller} />
                  )}
                  <label htmlFor="bag-search">{d.bagSearch}</label>
                  <div className="row">
                    <input
                      id="bag-search"
                      name="bag"
                      defaultValue={filters.bag || ''}
                      maxLength={20}
                      placeholder="K-123"
                      pattern="[ ]*([Kk][ ]*-[ ]*)?[1-9][0-9]*[ ]*|"
                    />
                    <button className="btn btn-secondary">
                      {d.searchButton}
                    </button>
                  </div>
                </WorkingForm>
                <nav
                  className="row wrap operation-filters received-bags-filters"
                  aria-label={d.queueColumns.status}
                >
                  <Link
                    aria-current={!filters.state ? 'page' : undefined}
                    href={bagQueueHref({
                      seller: filters.seller,
                      bag: filters.bag || undefined,
                    })}
                  >
                    {all.handovers.allStatuses}
                  </Link>
                  {(['open', 'completed'] as const).map((state) => (
                    <Link
                      key={state}
                      aria-current={
                        filters.state === state ? 'page' : undefined
                      }
                      href={bagQueueHref({
                        seller: filters.seller,
                        bag: filters.bag || undefined,
                        state,
                      })}
                    >
                      {all.bagProcessing[state]}
                    </Link>
                  ))}
                  {filters.state === 'unstarted' && (
                    <Link
                      aria-current="page"
                      href={bagQueueHref({
                        seller: filters.seller,
                        bag: filters.bag || undefined,
                        state: 'unstarted',
                      })}
                    >
                      {all.storeFlow.live.dropoffs}
                    </Link>
                  )}
                </nav>
                <div className="row wrap received-bags-clear">
                  {filters.bag && (
                    <Link
                      className="text-link"
                      href={bagQueueHref({
                        seller: filters.seller,
                        state: filters.state,
                      })}
                    >
                      {d.clearBagSearch}
                    </Link>
                  )}
                  {(filters.seller || filters.state) && (
                    <Link className="text-link" href={bagQueueHref({})}>
                      {d.showAllBags}
                    </Link>
                  )}
                </div>
                <CompactDirectory
                  label={d.queue}
                  columns={[
                    {
                      key: 'reference',
                      label: d.queueColumns.number,
                      width: 10,
                    },
                    { key: 'seller', label: d.queueColumns.seller, width: 25 },
                    {
                      key: 'received',
                      label: d.queueColumns.received,
                      width: 22,
                    },
                    { key: 'status', label: d.queueColumns.status, width: 20 },
                    {
                      key: 'actions',
                      label: d.queueColumns.actions,
                      mobileLabel: null,
                      width: 23,
                    },
                  ]}
                  rows={bags.items.map((bag) => ({
                    id: bag.id,
                    cells: [
                      <strong key="reference">K-{bag.reference}</strong>,
                      bag.sellers.name,
                      <time key="received" dateTime={bag.received_at}>
                        {new Date(bag.received_at).toLocaleString(
                          intlLocale(ctx.locale),
                          {
                            timeZone: 'Europe/Stockholm',
                            dateStyle: 'short',
                            timeStyle: 'short',
                          },
                        )}
                      </time>,
                      <span
                        key="status"
                        className="badge received-bag-status"
                        data-state={bag.processing_state}
                      >
                        {all.bagProcessing[bag.processing_state]}
                      </span>,
                      <div key="actions" className="received-bag-actions">
                        <Link
                          className="btn btn-primary directory-primary-link"
                          href={`/intake/bags/${bag.id}/inspect`}
                        >
                          {d.queueReview}
                        </Link>
                        <Link
                          className="text-link"
                          href={`/intake/bags/${bag.id}`}
                        >
                          {d.queueLabel}
                        </Link>
                      </div>,
                    ],
                  }))}
                />
                {!bags.items.length && <p>{d.noMatchingBags}</p>}
                <nav className="row" aria-label={d.bagPages}>
                  {bags.hasNewer && bags.items[0] && (
                    <Link
                      className="text-link"
                      href={bagQueueHref({
                        state: filters.state,
                        seller: filters.seller,
                        bag: filters.bag,
                        newer: bags.items[0].reference,
                      })}
                    >
                      {d.newerBags}
                    </Link>
                  )}
                  {bags.hasOlder && bags.items.at(-1) && (
                    <Link
                      className="text-link"
                      href={bagQueueHref({
                        state: filters.state,
                        seller: filters.seller,
                        bag: filters.bag,
                        older: bags.items.at(-1)!.reference,
                      })}
                    >
                      {d.olderBags}
                    </Link>
                  )}
                  {(filters.older || filters.newer) && (
                    <Link
                      className="text-link"
                      href={bagQueueHref({
                        state: filters.state,
                        seller: filters.seller,
                        bag: filters.bag,
                      })}
                    >
                      {d.firstBags}
                    </Link>
                  )}
                </nav>
              </section>
            ),
          },
        ]}
      />
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.intake.title)
