import { z } from 'zod'
import { storeCountries } from '@/lib/platform/countries'
import { SellerAgreementWorkspace } from '@/components/seller/agreement-workspace'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { SelfBillingDetails } from '@/components/intake/self-billing-details'
import { statementTitle } from '@/lib/engine/self-billing'
import { SellerBusinessSummary } from '@/components/intake/seller-business-summary'
import { businessDetails } from '@/lib/engine/seller-business'
import { SellerItems } from '@/components/seller/items'
import { MyRegistrations } from '@/components/seller-registration/pending'
import { readMyRegistrations } from '@/lib/engine/seller-registration'
import { StoreMailConsent } from '@/components/seller/store-mail-consent'
import { readMailConsent } from '@/lib/engine/store-mail'
import { economyFormat } from '@/lib/intake/economy-format'
import { WorkingForm } from '@/components/platform/working-form'
import { readSellerBank } from '@/lib/engine/seller-bank'
import { SellerBankEditor } from '@/components/seller/bank-details'
import Link from '@/components/platform/working-link'
import { readSubmissionSettings } from '@/lib/engine/seller-submissions'
import './seller-portal.css'
import { notFound, redirect } from 'next/navigation'
import { renderPlatformContext as platformContext } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import {
  readMySellerAccounts,
  readMySellerEconomy,
  readMySellerStatement,
} from '@/lib/engine/seller-portal'
import { SellerEconomyForms } from '@/components/seller/economy-forms'
import { SellerHandovers } from '@/components/seller/handover-forms'
import { readMyHandovers } from '@/lib/engine/handovers'
import {
  readMyItems,
  readMyItemsPage,
  sellerItemFilter,
} from '@/lib/engine/seller-items'
import { readStoreCurrency } from '@/lib/engine/money'
import { SellerHeader } from '@/components/seller/header'
import { EventTime } from '@/components/ui/event-time'
import {
  readMySellerAgreement,
  readMySellerAgreementArchive,
  readMySellerTermsSummary,
} from '@/lib/engine/seller-agreement'
export const generateMetadata = () =>
  platformPageMetadata((d) => d.sellerPortal.title, {
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    formatDetection: { email: false, telephone: false, address: false },
  })
export default async function SellerPortal({
  searchParams,
}: {
  searchParams: Promise<{
    seller?: string
    statement?: string
    q?: string
    status?: string
    page?: string
    agreementVersion?: string
    agreementText?: string
    agreementPage?: string
    stores?: string
  }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await platformContext()
  if (!ctx) redirect('/login?next=%2Fseller')
  if (ctx.mfaRequired) redirect('/mfa?next=%2Fseller')
  const all = dictionary(ctx.locale)
  const d = all.sellerPortal
  const label = (labels: Record<string, string>, key: string) =>
    labels[key] ?? d.kind
  const params = await searchParams
  const accounts = await readMySellerAccounts(ctx.client)
  if (!params.seller && params.stores !== '1' && accounts.length === 1) {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params))
      if (value && key !== 'stores') next.set(key, value)
    next.set('seller', accounts[0].sellerId)
    redirect(`/seller?${next}`)
  }
  const registrations = !params.seller
    ? await readMyRegistrations(ctx.client)
    : []
  const account = params.seller
    ? accounts.find((a) => a.sellerId === params.seller)
    : null
  if (params.seller && !account) notFound()
  const when = (date: string) =>
    new Date(date).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  const numbers = economyFormat(ctx.locale)
  const amount = (ore: number) => numbers.money(ore, currency)
  if (!account) {
    const summaries = await Promise.all(
      accounts.map(async (a) => {
        const [economy, items, currency] = await Promise.all([
          readMySellerEconomy(ctx.client, a.tenantId, a.sellerId),
          readMyItemsPage(ctx.client, a.tenantId, a.sellerId, {
            status: 'active',
          }),
          readStoreCurrency(ctx.client, a.tenantId),
        ])
        return {
          ...a,
          availableOre: economy.balance.availableOre,
          count: items?.total ?? 0,
          currency,
        }
      }),
    )
    return (
      <main
        className="onboarding seller-review seller-portal"
        lang={intlLocale(ctx.locale)}
      >
        <SellerHeader locale={ctx.locale} email={ctx.user.email} />
        <div className="page-heading">
          <h1>{all.sellerAccess.stores}</h1>
        </div>
        <div className="seller-store-list">
          {summaries.map((a) => (
            <Link
              className="card seller-store-card"
              key={a.sellerId}
              href={`/seller?seller=${a.sellerId}`}
            >
              <h2>{a.storeName}</h2>
              {a.count > 0 && (
                <p>
                  {d.itemStatusTabs.active}: {numbers.number(a.count)}
                </p>
              )}
              {a.availableOre > 0 && (
                <p>
                  {d.available}: {numbers.money(a.availableOre, a.currency)}
                </p>
              )}
              <span className="seller-store-open">
                {all.sellerPortalWorkspace.open}{' '}
                <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
          <MyRegistrations
            rows={registrations}
            d={all.selfRegistration}
            labels={all.sellerPortalWorkspace}
          />
          {accounts.length === 0 &&
            !registrations.some((r) => r.state !== 'approved') && (
              <section className="card">
                <p>{all.sellerPortalWorkspace.emptyStores}</p>
              </section>
            )}
        </div>
      </main>
    )
  }
  const identity = await ctx.client.rpc('my_seller_business', {
    p_tenant: account.tenantId,
    p_seller: account.sellerId,
  })
  if (identity.error) throw new Error('Unable to read seller identity')
  const business = identity.data?.business
    ? businessDetails.parse(identity.data.business)
    : null
  const mailConsent = await readMailConsent(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  const submissionSettings = await readSubmissionSettings(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  const base = `/seller?seller=${account.sellerId}`
  const agreement = await readMySellerAgreement(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  for (const value of [params.agreementVersion, params.agreementText])
    if (value !== undefined && !z.uuid().safeParse(value).success) notFound()
  const agreementPage = /^[1-9]\d{0,5}$/.test(params.agreementPage ?? '')
    ? Math.min(100000, Number(params.agreementPage))
    : 1
  const [agreementArchive, agreementSummary] = await Promise.all([
    readMySellerAgreementArchive(
      ctx.client,
      account.tenantId,
      account.sellerId,
      params.agreementVersion ?? null,
      agreementPage,
      params.agreementText ?? null,
    ),
    readMySellerTermsSummary(ctx.client, account.tenantId, account.sellerId),
  ])
  if (params.agreementVersion && !agreementArchive.agreement) notFound()
  const agreementPages = Math.max(1, Math.ceil(agreementArchive.total / 20))
  if (agreementPage > agreementPages) {
    const q = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
    q.set('agreementPage', String(agreementPages))
    redirect('/seller?' + q + '#seller-workspace-agreement')
  }
  const currency = await readStoreCurrency(ctx.client, account.tenantId)
  const countryNames = new Intl.DisplayNames([intlLocale(ctx.locale)], {
    type: 'region',
  })
  const bankCountries = storeCountries
    .map((code) => ({ code, name: countryNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, intlLocale(ctx.locale)))
  const bank = await readSellerBank(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  if (params.statement) {
    if (!/^[0-9a-f-]{36}$/i.test(params.statement)) notFound()
    const statement = await readMySellerStatement(
      ctx.client,
      account.tenantId,
      account.sellerId,
      params.statement,
    )
    if (!statement) notFound()
    return (
      <main
        className="onboarding seller-review seller-portal"
        lang={intlLocale(ctx.locale)}
      >
        <SellerHeader locale={ctx.locale} email={ctx.user.email} />
        <section className="card">
          <Link className="text-link" href={base + '#seller-workspace-payouts'}>
            {account.storeName}
          </Link>
          <h1>
            {statement.header.self_billing
              ? statementTitle(statement.header, all.statements)
              : d.statements}{' '}
            #{statement.header.number}
          </h1>
          <p>
            {when(statement.header.period_from)} —{' '}
            {when(statement.header.period_to)}
          </p>
          <p>
            {d.opening}: {amount(statement.header.opening_ore)}
          </p>
          <p>
            {d.closing}: {amount(statement.header.closing_ore)}
          </p>
          {statement.header.self_billing && (
            <>
              <SelfBillingDetails
                invoice={statement.header.self_billing}
                locale={ctx.locale}
              />
              <a
                className="btn btn-secondary"
                href={`/api/seller/statement/pdf?tenant=${account.tenantId}&seller=${account.sellerId}&statement=${statement.header.id}`}
              >
                {all.statements.downloadPdf}
              </a>
            </>
          )}
          <table className="seller-statement-lines">
            <thead>
              <tr>
                <th>{d.date}</th>
                <th>{d.kind}</th>
                <th>{d.amount.replace('{currency}', currency)}</th>
                <th>{d.salePrice}</th>
                <th>{d.commission}</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l) => (
                <tr key={l.id}>
                  <td data-label={d.date}>
                    <EventTime value={l.occurred_at} locale={ctx.locale} />
                  </td>
                  <td data-label={d.kind}>{label(all.ledger.kinds, l.kind)}</td>
                  <td data-label={d.amount.replace('{currency}', currency)}>
                    {amount(l.amount_ore)}
                  </td>
                  <td data-label={d.salePrice}>
                    {l.sale_price_ore === null ? '—' : amount(l.sale_price_ore)}
                  </td>
                  <td data-label={d.commission}>
                    {l.commission_ore === null ? '—' : amount(l.commission_ore)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    )
  }
  const query =
    typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const parsedStatus = sellerItemFilter.safeParse(params.status ?? 'active')
  const status =
    parsedStatus.success && parsedStatus.data !== 'all'
      ? parsedStatus.data
      : 'active'
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const pageHref = (page: number, selectedStatus = status) => {
    const search = new URLSearchParams({
      seller: account.sellerId,
      status: selectedStatus,
    })
    if (query) search.set('q', query)
    if (page > 1) search.set('page', String(page))
    return '/seller?' + search.toString() + '#portal-items'
  }
  const [economy, handovers, paged] = await Promise.all([
    readMySellerEconomy(ctx.client, account.tenantId, account.sellerId),
    readMyHandovers(ctx.client, account.tenantId, account.sellerId),
    readMyItemsPage(ctx.client, account.tenantId, account.sellerId, {
      query,
      status,
      offset: (requestedPage - 1) * 25,
    }),
  ])
  const pageCount = paged ? Math.max(1, Math.ceil(paged.total / 25)) : 1
  if (paged && requestedPage > pageCount) redirect(pageHref(pageCount))
  const mine =
    paged ?? (await readMyItems(ctx.client, account.tenantId, account.sellerId))
  const itemPagination = paged && pageCount > 1 && (
    <nav
      className="items-directory-pagination"
      aria-label={all.items.pagination}
    >
      {requestedPage > 1 && (
        <Link className="btn btn-secondary" href={pageHref(requestedPage - 1)}>
          {all.items.previousPage}
        </Link>
      )}
      <span>
        {all.items.pageOf
          .replace('{page}', numbers.number(requestedPage))
          .replace('{pages}', numbers.number(pageCount))}
      </span>
      {requestedPage < pageCount && (
        <Link className="btn btn-secondary" href={pageHref(requestedPage + 1)}>
          {all.items.nextPage}
        </Link>
      )}
    </nav>
  )
  // Pending and failed messages remain expanded in the details tab.
  const messagesOpen = economy.messages.some((m) =>
    ['queued', 'failed'].includes(m.status),
  )
  return (
    <main
      className="onboarding seller-review seller-portal"
      lang={intlLocale(ctx.locale)}
    >
      <SellerHeader locale={ctx.locale} email={ctx.user.email} />
      <div className="page-heading">
        <Link href="/seller?stores=1">{all.sellerAccess.stores}</Link>
        <h1>{account.storeName}</h1>
      </div>
      <WorkspaceTabs
        id="seller-workspace"
        label={all.sellerPortalWorkspace.navigation}
        scrollAnchors
        tabs={[
          {
            id: 'items',
            label: d.items,
            anchors: ['portal-items', 'portal-handovers'],
            content: (
              <>
                {mine && (
                  <section
                    id="portal-items"
                    className="card"
                    aria-label={d.items}
                    tabIndex={-1}
                  >
                    <h2>{d.items}</h2>
                    {paged ? (
                      <>
                        <nav
                          className="seller-item-tabs"
                          aria-label={d.itemsStatus}
                        >
                          {(['active', 'sold', 'ended'] as const).map(
                            (value) => (
                              <Link
                                key={value}
                                href={pageHref(1, value)}
                                aria-current={
                                  status === value ? 'page' : undefined
                                }
                              >
                                {d.itemStatusTabs[value]}
                                {paged.counts
                                  ? ` (${numbers.number(paged.counts[value])})`
                                  : ''}
                              </Link>
                            ),
                          )}
                        </nav>
                        <WorkingForm
                          key={`${query}:${status}`}
                          action="/seller#portal-items"
                          role="search"
                          className="seller-items-search"
                        >
                          <input
                            type="hidden"
                            name="seller"
                            value={account.sellerId}
                          />
                          <input type="hidden" name="status" value={status} />
                          <div className="field">
                            <label htmlFor="seller-items-q">
                              {all.items.search}
                            </label>
                            <input
                              id="seller-items-q"
                              name="q"
                              defaultValue={query}
                              maxLength={120}
                              placeholder={d.itemsSearchHint}
                            />
                          </div>
                          <button className="btn btn-primary">
                            {all.items.searchButton}
                          </button>
                          {(query || status !== 'active') && (
                            <Link
                              className="btn btn-secondary"
                              href={base + '#portal-items'}
                            >
                              {all.items.clearFilters}
                            </Link>
                          )}
                        </WorkingForm>
                        <p>
                          <small>
                            {paged.total > 0
                              ? all.items.showingRange
                                  .replace(
                                    '{from}',
                                    numbers.number(paged.offset + 1),
                                  )
                                  .replace(
                                    '{to}',
                                    numbers.number(
                                      paged.offset + paged.items.length,
                                    ),
                                  )
                                  .replace(
                                    '{total}',
                                    numbers.number(paged.total),
                                  )
                              : all.items.showing
                                  .replace('{shown}', '0')
                                  .replace('{total}', '0')}
                          </small>
                        </p>
                      </>
                    ) : (
                      <p role="status">{d.itemsLimited}</p>
                    )}
                    {mine.items.length === 0 && (
                      <p>
                        {query && paged
                          ? all.items.noMatches
                          : paged
                            ? d.itemFilterEmpty[status]
                            : d.noItems}
                      </p>
                    )}
                    {itemPagination}
                    {mine.items.length > 0 && (
                      <SellerItems mine={mine} locale={ctx.locale} d={d} />
                    )}
                    {itemPagination}
                  </section>
                )}

                {process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED === 'true' &&
                  submissionSettings.enabled && (
                    <Link
                      className="btn btn-secondary"
                      href={`/seller/submissions?seller=${account.sellerId}`}
                    >
                      {all.submissions.title}
                    </Link>
                  )}

                <SellerHandovers
                  key={`handovers:${account.tenantId}:${account.sellerId}`}
                  tenantId={account.tenantId}
                  sellerId={account.sellerId}
                  handovers={handovers}
                  locale={ctx.locale}
                  d={d}
                  recovery={all.intake}
                />
              </>
            ),
          },
          {
            id: 'payouts',
            label: d.payouts,
            anchors: ['portal-payout-request', 'portal-statements'],
            content: (
              <>
                <SellerEconomyForms
                  view="payout"
                  reservedOre={economy.balance.reservedOre}
                  key={`economy:${account.tenantId}:${account.sellerId}`}
                  tenantId={account.tenantId}
                  sellerId={account.sellerId}
                  currency={currency}
                  locale={ctx.locale}
                  availableOre={economy.balance.availableOre}
                  thresholdOre={economy.thresholdOre}
                  enabled={economy.automaticEmails}
                  d={d}
                  recovery={all.intake}
                />

                <SellerBankEditor
                  key={`bank:${account.sellerId}:${bank?.id}`}
                  tenantId={account.tenantId}
                  sellerId={account.sellerId}
                  current={bank}
                  countries={bankCountries}
                  d={all}
                />

                <section className="card">
                  <h2>{all.sellerPortalWorkspace.previousPayouts}</h2>
                  <p className="muted">{d.recent}</p>
                  {economy.payouts.length === 0 && <p>{d.none}</p>}
                  {economy.payouts.map((p) => (
                    <p key={p.id}>
                      <EventTime value={p.requested_at} locale={ctx.locale} /> ·{' '}
                      {amount(p.amount_ore)} ·{' '}
                      {label(all.payouts.statuses, p.status)}
                    </p>
                  ))}
                </section>

                {economy.statements.some((s) => s.is_self_billing) && (
                  <section
                    id="portal-statements"
                    className="card"
                    tabIndex={-1}
                  >
                    <h2>{all.sellerPortalWorkspace.invoices}</h2>

                    {economy.statements
                      .filter((s) => s.is_self_billing)
                      .map((s) => (
                        <p key={s.id}>
                          <Link href={`${base}&statement=${s.id}`}>
                            {statementTitle(s, all.statements)} #{s.number}
                          </Link>{' '}
                          · {amount(s.closing_ore)}
                        </p>
                      ))}
                  </section>
                )}
              </>
            ),
          },
          {
            id: 'details',
            label: all.sellerPortalWorkspace.details,
            anchors: ['portal-messages'],
            content: (
              <>
                <section className="card">
                  <h2>{all.sellerPortalWorkspace.details}</h2>
                  <p>
                    {all.email}: <span>{ctx.user.email}</span>
                  </p>
                  <Link href="/account">
                    {all.sellerPortalWorkspace.account}
                  </Link>
                </section>
                {identity.data?.sellerType === 'business' && (
                  <SellerBusinessSummary
                    d={all.sellerDetails.business}
                    business={business}
                  />
                )}

                <SellerEconomyForms
                  view="notifications"
                  key={`preferences:${account.tenantId}:${account.sellerId}`}
                  tenantId={account.tenantId}
                  sellerId={account.sellerId}
                  currency={currency}
                  locale={ctx.locale}
                  availableOre={economy.balance.availableOre}
                  thresholdOre={economy.thresholdOre}
                  enabled={economy.automaticEmails}
                  d={d}
                  recovery={all.intake}
                />

                <StoreMailConsent
                  locale={ctx.locale}
                  key={`store-mail:${account.sellerId}:${mailConsent.id}`}
                  tenantId={account.tenantId}
                  sellerId={account.sellerId}
                  current={mailConsent}
                  d={all.storeMail}
                />

                <details
                  className="card seller-portal-fold"
                  id="portal-messages"
                  data-testid="portal-messages"
                  open={messagesOpen}
                >
                  <summary>
                    <h2>
                      {d.messages} · {economy.messages.length}
                    </h2>
                  </summary>
                  <p className="muted">{d.recent}</p>
                  {economy.messages.length === 0 && <p>{d.none}</p>}
                  {economy.messages.map((m) => (
                    <article key={m.id}>
                      <h3>{m.subject}</h3>
                      <p>
                        <EventTime value={m.queued_at} locale={ctx.locale} /> ·{' '}
                        {label(all.communications.outcomes, m.status)}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </article>
                  ))}
                </details>
              </>
            ),
          },
          {
            id: 'agreement',
            label: all.sellerPortalWorkspace.agreement,
            notice:
              agreement.agreement && !agreement.acceptance
                ? all.sellerAgreementSummary.needsApproval
                : undefined,
            content: (
              <SellerAgreementWorkspace
                tenantId={account.tenantId}
                sellerId={account.sellerId}
                storeName={account.storeName}
                locale={ctx.locale}
                state={agreementArchive}
                summary={agreementSummary}
                page={agreementPage}
                base={base}
              />
            ),
          },
        ]}
      />
    </main>
  )
}
