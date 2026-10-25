import { SellerBusinessSummary } from '@/components/intake/seller-business-summary'
import { businessDetails } from '@/lib/engine/seller-business'
import { SellerItems } from '@/components/seller/items'
import { MyRegistrations } from '@/components/seller-registration/pending'
import { readMyRegistrations } from '@/lib/engine/seller-registration'
import { StoreMailConsent } from '@/components/seller/store-mail-consent'
import { readMailConsent } from '@/lib/engine/store-mail'
import { economyFormat } from '@/lib/intake/economy-format'
import { WorkingForm } from '@/components/platform/working-form'
import { LedgerItemSummary } from '@/components/intake/ledger-item-summary'
import { readSellerBank } from '@/lib/engine/seller-bank'
import { SellerBankEditor } from '@/components/seller/bank-details'
import { readConsignmentFees } from '@/lib/engine/consignment-fees'
import { ConsignmentFeeHistory } from '@/components/intake/consignment-fee-history'
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
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { SellerEconomyForms } from '@/components/seller/economy-forms'
import { SellerHandovers } from '@/components/seller/handover-forms'
import { readMyHandovers } from '@/lib/engine/handovers'
import {
  readMyItems,
  readMyItemsPage,
  sellerItemFilter,
} from '@/lib/engine/seller-items'
import { readStoreCurrency } from '@/lib/engine/money'
import { SignOut } from '@/components/platform/sign-out'
import { SellerHeader } from '@/components/seller/header'
import { EventTime } from '@/components/ui/event-time'
import { readMySellerAgreement } from '@/lib/engine/seller-agreement'
export const generateMetadata = () =>
  platformPageMetadata((d) => d.sellerPortal.title, {
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
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
    feePage?: string
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
  const amount = (ore: number) => `${formatSignedOre(ore)} ${currency}`
  if (!account)
    return (
      <main className="onboarding seller-review" lang={intlLocale(ctx.locale)}>
        <SellerHeader locale={ctx.locale} />
        <SignOut d={all} next="/seller" />
        <section className="card">
          <h1>{d.title}</h1>
          <p>{ctx.user.email}</p>
          {accounts.length === 0 && registrations.length === 0 && (
            <p>{d.empty}</p>
          )}
          {accounts.map((a) => (
            <p key={a.sellerId}>
              <Link href={`/seller?seller=${a.sellerId}`}>{a.storeName}</Link>
            </p>
          ))}
        </section>
        <MyRegistrations rows={registrations} d={all.selfRegistration} />
      </main>
    )
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
  const currency = await readStoreCurrency(ctx.client, account.tenantId)
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
      <main className="onboarding seller-review" lang={intlLocale(ctx.locale)}>
        <SellerHeader locale={ctx.locale} />
        <SignOut d={all} next="/seller" />
        <section className="card">
          <Link className="text-link" href={base + '#portal-statements'}>
            {account.storeName}
          </Link>
          <h1>
            {d.statements} #{statement.header.number}
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
  const feePage =
    params.feePage === undefined
      ? 0
      : /^\d{1,7}$/.test(params.feePage)
        ? Number(params.feePage)
        : -1
  if (feePage < 0 || feePage > 1000000) notFound()
  const fees = await readConsignmentFees(
    ctx.client,
    account.tenantId,
    account.sellerId,
    feePage * 25,
    true,
  )
  const query =
    typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const parsedStatus = sellerItemFilter.safeParse(params.status ?? 'active')
  const status = parsedStatus.success ? parsedStatus.data : 'active'
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const pageHref = (page: number) => {
    const search = new URLSearchParams({ seller: account.sellerId, status })
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
  // Ledger and message history fold behind their headings; both stay a count
  // away and a message that is still queued or has failed keeps its list open.
  const messagesOpen = economy.messages.some((m) =>
    ['queued', 'failed'].includes(m.status),
  )
  return (
    <main
      className="onboarding seller-review seller-portal"
      lang={intlLocale(ctx.locale)}
    >
      <SellerHeader locale={ctx.locale} />
      <SignOut d={all} next="/seller" />
      <div className="page-heading">
        <Link href="/seller">{d.back}</Link>
        <h1>
          {account.storeName} · {d.title}
        </h1>
        <p>{ctx.user.email}</p>
      </div>
      <section className="card">
        <h2>
          {d.available}: {amount(economy.balance.availableOre)}
        </h2>
        <p>
          {d.reserved}: {amount(economy.balance.reservedOre)}
        </p>
      </section>
      {identity.data?.sellerType === 'business' && (
        <SellerBusinessSummary
          d={all.sellerDetails.business}
          business={business}
        />
      )}
      <nav className="seller-portal-shortcuts" aria-label={d.title}>
        {process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED === 'true' &&
          submissionSettings.enabled && (
            <Link
              className="btn btn-secondary"
              href={`/seller/submissions?seller=${account.sellerId}`}
            >
              {all.submissions.title}
            </Link>
          )}
        {mine && (
          <a className="btn btn-secondary" href="#portal-items">
            {d.items}
          </a>
        )}
        {(handovers.enabled || handovers.handovers.length > 0) && (
          <a className="btn btn-secondary" href="#portal-handovers">
            {handovers.enabled ? d.handovers : d.handoverHistory}
          </a>
        )}
        <a className="btn btn-secondary" href="#portal-payout-request">
          {d.request}
        </a>
        <a className="btn btn-secondary" href="#portal-statements">
          {d.statements}
        </a>
      </nav>
      {agreement.agreement && (
        <section className="card" aria-label={all.sellerAgreement.title}>
          <Link
            className="text-link"
            href={`/seller/agreement?seller=${account.sellerId}`}
          >
            {agreement.acceptance
              ? all.sellerAgreement.view
              : all.sellerAgreement.review}
          </Link>
          {agreement.acceptance && (
            <p>
              {agreement.acceptance.source === 'seller_portal'
                ? all.sellerAgreement.accepted
                : all.sellerAgreement.recorded}
            </p>
          )}
        </section>
      )}
      <SellerEconomyForms
        key={`economy:${account.tenantId}:${account.sellerId}`}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        currency={currency}
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
      <SellerBankEditor
        key={`bank:${account.sellerId}:${bank?.id}`}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        current={bank}
        locale={ctx.locale}
        d={all}
      />
      <SellerHandovers
        key={`handovers:${account.tenantId}:${account.sellerId}`}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        handovers={handovers}
        locale={ctx.locale}
        d={d}
        recovery={all.intake}
      />
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
              <WorkingForm
                key={`${query}:${status}`}
                action="/seller#portal-items"
                role="search"
                className="seller-items-search"
              >
                <input type="hidden" name="seller" value={account.sellerId} />
                <div className="field">
                  <label htmlFor="seller-items-q">{all.items.search}</label>
                  <input
                    id="seller-items-q"
                    name="q"
                    defaultValue={query}
                    maxLength={120}
                    placeholder={d.itemsSearchHint}
                  />
                </div>
                <div className="field seller-items-status">
                  <label htmlFor="seller-items-status">{d.itemsStatus}</label>
                  <select
                    id="seller-items-status"
                    name="status"
                    defaultValue={status}
                  >
                    {sellerItemFilter.options.map((value) => (
                      <option key={value} value={value}>
                        {d.itemFilters[value]}
                      </option>
                    ))}
                  </select>
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
                        .replace('{from}', numbers.number(paged.offset + 1))
                        .replace(
                          '{to}',
                          numbers.number(paged.offset + paged.items.length),
                        )
                        .replace('{total}', numbers.number(paged.total))
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
      <p>{d.recent}</p>
      <section className="card">
        <h2>{d.payouts}</h2>
        {economy.payouts.length === 0 && <p>{d.none}</p>}
        {economy.payouts.map((p) => (
          <p key={p.id}>
            <EventTime value={p.requested_at} locale={ctx.locale} /> ·{' '}
            {amount(p.amount_ore)} · {label(all.payouts.statuses, p.status)} ·{' '}
            {d.source}: {d[p.request_source]}
          </p>
        ))}
      </section>
      <details className="card seller-portal-fold" data-testid="portal-ledger">
        <summary>
          <h2>
            {d.ledger} · {economy.ledger.length}
          </h2>
        </summary>
        {economy.ledger.length === 0 && <p>{d.none}</p>}
        {economy.ledger.map((l) => (
          <p key={l.id}>
            <EventTime value={l.occurred_at} locale={ctx.locale} /> ·{' '}
            {label(all.ledger.kinds, l.kind)} · {amount(l.amount_ore)}
            {l.kind === 'credit_sale' && l.itemDetails && (
              <LedgerItemSummary
                details={l.itemDetails}
                currency={currency}
                d={all}
              />
            )}
            {l.itemDetails && (
              <>
                {' '}
                · {l.itemDetails.title || l.itemDetails.reference} ·{' '}
                {l.itemDetails.reference}
              </>
            )}
          </p>
        ))}
      </details>
      <ConsignmentFeeHistory
        fees={fees}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        d={all}
        locale={ctx.locale}
        page={feePage}
        base={base}
      />
      <section id="portal-statements" className="card" tabIndex={-1}>
        <h2>{d.statements}</h2>
        {economy.statements.length === 0 && <p>{d.none}</p>}
        {economy.statements.map((s) => (
          <p key={s.id}>
            <Link href={`${base}&statement=${s.id}`}>
              {d.open} #{s.number}
            </Link>{' '}
            · {amount(s.closing_ore)}
          </p>
        ))}
      </section>
      <details
        className="card seller-portal-fold"
        data-testid="portal-messages"
        open={messagesOpen}
      >
        <summary>
          <h2>
            {d.messages} · {economy.messages.length}
          </h2>
        </summary>
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
    </main>
  )
}
