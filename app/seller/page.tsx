import Link from 'next/link'
import './seller-portal.css'
import { notFound, redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
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
  sellerItemDaysLeft,
  sellerItemNextStep,
  sellerItemState,
} from '@/lib/engine/seller-items'
import { readStoreCurrency } from '@/lib/engine/money'
import { SignOut } from '@/components/platform/sign-out'
import { Brand } from '@/components/platform/brand'
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}
export default async function SellerPortal({
  searchParams,
}: {
  searchParams: Promise<{
    seller?: string
    statement?: string
    q?: string
    page?: string
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
  const account = params.seller
    ? accounts.find((a) => a.sellerId === params.seller)
    : null
  if (params.seller && !account) notFound()
  const when = (date: string) =>
    new Date(date).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  const day = (date: string) =>
    new Date(date).toLocaleDateString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  const amount = (ore: number) => `${formatSignedOre(ore)} ${currency}`
  if (!account)
    return (
      <main className="onboarding seller-review">
        <Brand />
        <SignOut d={all} next="/seller" />
        <section className="card">
          <h1>{d.title}</h1>
          <p>{ctx.user.email}</p>
          {accounts.length === 0 && <p>{d.empty}</p>}
          {accounts.map((a) => (
            <p key={a.sellerId}>
              <Link href={`/seller?seller=${a.sellerId}`}>{a.storeName}</Link>
            </p>
          ))}
        </section>
      </main>
    )
  const base = `/seller?seller=${account.sellerId}`
  const currency = await readStoreCurrency(ctx.client, account.tenantId)
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
      <main className="onboarding seller-review">
        <Brand />
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
                  <td data-label={d.date}>{when(l.occurred_at)}</td>
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
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const pageHref = (page: number) => {
    const search = new URLSearchParams({ seller: account.sellerId })
    if (query) search.set('q', query)
    if (page > 1) search.set('page', String(page))
    return '/seller?' + search.toString() + '#portal-items'
  }
  const [economy, handovers, paged] = await Promise.all([
    readMySellerEconomy(ctx.client, account.tenantId, account.sellerId),
    readMyHandovers(ctx.client, account.tenantId, account.sellerId),
    readMyItemsPage(ctx.client, account.tenantId, account.sellerId, {
      query,
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
          .replace('{page}', String(requestedPage))
          .replace('{pages}', String(pageCount))}
      </span>
      {requestedPage < pageCount && (
        <Link className="btn btn-secondary" href={pageHref(requestedPage + 1)}>
          {all.items.nextPage}
        </Link>
      )}
    </nav>
  )
  return (
    <main className="onboarding seller-review">
      <Brand />
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
      <nav className="seller-portal-shortcuts" aria-label={d.title}>
        {mine && (
          <a className="btn btn-secondary" href="#portal-items">
            {d.items}
          </a>
        )}
        <a className="btn btn-secondary" href="#portal-handovers">
          {d.handovers}
        </a>
        <a className="btn btn-secondary" href="#portal-payout-request">
          {d.request}
        </a>
        <a className="btn btn-secondary" href="#portal-statements">
          {d.statements}
        </a>
      </nav>
      <SellerEconomyForms
        key={`${account.sellerId}-${economy.automaticEmails}`}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        currency={currency}
        availableOre={economy.balance.availableOre}
        thresholdOre={economy.thresholdOre}
        enabled={economy.automaticEmails}
        d={d}
      />
      <SellerHandovers
        key={`${account.tenantId}:${account.sellerId}`}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        handovers={handovers}
        locale={ctx.locale}
        d={d}
      />
      {mine && (
        <section
          id="portal-items"
          className="card"
          aria-label={d.items}
          tabIndex={-1}
        >
          <h2>{d.items}</h2>
          <p>{d.itemsIntro}</p>
          {paged ? (
            <>
              <form
                key={query}
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
                <button className="btn btn-primary">
                  {all.items.searchButton}
                </button>
                {query && (
                  <Link
                    className="btn btn-secondary"
                    href={base + '#portal-items'}
                  >
                    {all.items.clearFilters}
                  </Link>
                )}
              </form>
              <p>
                <small>
                  {paged.total > 0
                    ? all.items.showingRange
                        .replace('{from}', String(paged.offset + 1))
                        .replace(
                          '{to}',
                          String(paged.offset + paged.items.length),
                        )
                        .replace('{total}', String(paged.total))
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
            <p>{query && paged ? all.items.noMatches : d.noItems}</p>
          )}
          {itemPagination}
          {mine.items.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="seller-items">
                <thead>
                  <tr>
                    <th>{d.item}</th>
                    <th>{d.price}</th>
                    <th>{d.status}</th>
                    <th>{d.itemDate}</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.items.map((i) => {
                    const state = sellerItemState(i)
                    return (
                      <tr key={i.id}>
                        <td data-label={d.item}>
                          {i.title ?? i.reference}
                          {i.category ? ` · ${i.category}` : ''}
                          <br />
                          <small>{i.reference}</small>
                        </td>
                        <td data-label={d.price}>
                          {state === 'sold' && i.soldPriceOre !== null
                            ? amount(i.soldPriceOre)
                            : i.currentPriceOre === null
                              ? '—'
                              : amount(i.currentPriceOre)}
                          {state !== 'sold' &&
                          i.acceptedPriceOre !== null &&
                          i.currentPriceOre !== null &&
                          i.currentPriceOre < i.acceptedPriceOre
                            ? ` (${d.wasPrice} ${amount(i.acceptedPriceOre)})`
                            : ''}
                        </td>
                        <td data-label={d.status}>
                          {d.itemStates[state]}
                          {state === 'ended' && i.endedAs
                            ? ` · ${label(d.endedAs, i.endedAs)}`
                            : ''}
                          {(state === 'periodEnding' ||
                            state === 'periodEnded') &&
                          i.endOfPeriodAction
                            ? ` · ${d.then} ${d.endActions[i.endOfPeriodAction]}`
                            : ''}
                          {(state === 'forSale' || state === 'periodEnding') &&
                            (() => {
                              const next = sellerItemNextStep(i)
                              const days = sellerItemDaysLeft(i)
                              // Undefined: the read predates the next-step fields; say nothing about steps.
                              const text =
                                next === undefined
                                  ? ''
                                  : next
                                    ? (mine.automaticMarkdowns
                                        ? d.nextPriceScheduled
                                        : d.nextPriceManual
                                      )
                                        .replace(
                                          '{price}',
                                          amount(next.priceOre),
                                        )
                                        .replace('{date}', day(next.at))
                                    : d.lastPrice
                              const left = d.daysLeft.replace(
                                '{days}',
                                String(days),
                              )
                              const then =
                                state === 'forSale' && i.endOfPeriodAction
                                  ? `, ${d.then} ${d.endActions[i.endOfPeriodAction]}`
                                  : ''
                              return (
                                <>
                                  <br />
                                  <small>
                                    {text} {left}
                                    {then}
                                  </small>
                                </>
                              )
                            })()}
                        </td>
                        <td data-label={d.itemDate}>
                          {state === 'sold' && i.soldAt
                            ? when(i.soldAt)
                            : state === 'ended'
                              ? '—'
                              : `${d.until} ${when(i.periodEnd)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
            {when(p.requested_at)} · {amount(p.amount_ore)} ·{' '}
            {label(all.payouts.statuses, p.status)} · {d.source}:{' '}
            {d[p.request_source]}
          </p>
        ))}
      </section>
      <section className="card">
        <h2>{d.ledger}</h2>
        {economy.ledger.length === 0 && <p>{d.none}</p>}
        {economy.ledger.map((l) => (
          <p key={l.id}>
            {when(l.occurred_at)} · {label(all.ledger.kinds, l.kind)} ·{' '}
            {amount(l.amount_ore)}
          </p>
        ))}
      </section>
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
      <section className="card">
        <h2>{d.messages}</h2>
        {economy.messages.length === 0 && <p>{d.none}</p>}
        {economy.messages.map((m) => (
          <article key={m.id}>
            <h3>{m.subject}</h3>
            <p>
              {when(m.queued_at)} ·{' '}
              {label(all.communications.outcomes, m.status)}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
