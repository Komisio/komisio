import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { readPayoutBanks } from '@/lib/engine/seller-bank'
import { PayoutBankReview } from '@/components/seller/bank-details'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readPayoutsPage,
  type PayoutRow,
  readPayoutEvents,
  readSettlementCandidates,
} from '@/lib/engine/payouts'
import { readFlaggedReturns } from '@/lib/engine/returns'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { readPayoutRequestSellers } from '@/lib/engine/payout-request-sellers'
import {
  PayoutRequestForm,
  PayoutDecision,
  SettlementForm,
} from '@/components/intake/payout-forms'

export default async function Payouts({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.payouts
  const params = await searchParams
  const parsePage = (value: string | string[] | undefined) =>
    typeof value === 'string' && /^[1-9]\d{0,4}$/.test(value)
      ? Number(value)
      : 1
  const openPage = parsePage(params.openPage),
    historyPage = parsePage(params.historyPage)
  const pageHref = (group: 'open' | 'history', page: number) => {
    const query = new URLSearchParams()
    const open = group === 'open' ? page : openPage
    const history = group === 'history' ? page : historyPage
    if (open > 1) query.set('openPage', String(open))
    if (history > 1) query.set('historyPage', String(history))
    return (
      '/intake/payouts' + (query.size ? '?' + query : '') + '#payouts-' + group
    )
  }
  const [open, history, balances, flagged, settlement] = await Promise.all([
    readPayoutsPage(ctx.client, active.id, 'open', openPage),
    readPayoutsPage(ctx.client, active.id, 'history', historyPage),
    readPayoutRequestSellers(ctx.client, active.id),
    readFlaggedReturns(ctx.client, active.id),
    readSettlementCandidates(ctx.client, active.id),
  ])
  const openPages = Math.max(1, Math.ceil(open.count / 25))
  const historyPages = Math.max(1, Math.ceil(history.count / 25))
  if (openPage > openPages) redirect(pageHref('open', openPages))
  if (historyPage > historyPages) redirect(pageHref('history', historyPages))
  const payouts = [...open.rows, ...history.rows]
  const banks = ['owner', 'admin'].includes(active.role)
    ? await readPayoutBanks(
        ctx.client,
        active.id,
        payouts.map((p) => p.id),
      )
    : {}
  const events = await readPayoutEvents(
    ctx.client,
    active.id,
    payouts.map((p) => p.id),
  )
  const names = new Map(balances.map((s) => [s.id, s.name]))
  // The request selector is bounded independently of both list pages.
  // Resolve missing display names within this tenant.
  const missing = [
    ...new Set(payouts.map((p) => p.seller_id).filter((id) => !names.has(id))),
  ]
  if (missing.length > 0) {
    const more = await ctx.client
      .from('sellers')
      .select('id,name')
      .eq('tenant_id', active.id)
      .in('id', missing)
    if (more.error) throw new Error('Unable to read sellers')
    for (const s of z
      .array(z.object({ id: z.uuid(), name: z.string() }))
      .parse(more.data))
      names.set(s.id, s.name)
  }
  // The on-behalf form offers the first 50 sellers by name that hold credit;
  // the page says so when that bounded list is empty instead of claiming
  // nobody in the store is eligible.
  const eligible = balances.filter((s) => s.availableOre > 0)
  const write = active.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  function list(
    group: 'open' | 'history',
    rows: PayoutRow[],
    count: number,
    current: number,
    pages: number,
  ) {
    const pager =
      pages > 1 ? (
        <nav className="seller-directory-pagination" aria-label={d.tabs[group]}>
          {current > 1 && (
            <Link
              className="btn btn-secondary"
              href={pageHref(group, current - 1)}
            >
              {all.sellersList.previousPage}
            </Link>
          )}
          <span>
            {all.sellersList.pageOf
              .replace('{page}', String(current))
              .replace('{pages}', String(pages))}
          </span>
          {current < pages && (
            <Link
              className="btn btn-secondary"
              href={pageHref(group, current + 1)}
            >
              {all.sellersList.nextPage}
            </Link>
          )}
        </nav>
      ) : null
    return (
      <section
        className="card intake-form payout-register"
        data-testid={group === 'open' ? 'payout-list' : 'payout-history-list'}
      >
        <div className="workspace-heading">
          <h2>{d.tabs[group]}</h2>
          <span>{d.listCount.replace('{count}', String(count))}</span>
        </div>
        {rows.length === 0 && (
          <p>{group === 'open' ? d.noOpen : d.noHistory}</p>
        )}
        {pager}
        {rows.map((p) => (
          <div key={p.id} className="intake-notice payout-entry">
            <div className="payout-entry-heading">
              <Link
                className="text-link"
                href={`/intake/sellers/${p.seller_id}`}
              >
                {names.get(p.seller_id) ?? p.seller_id}
              </Link>
              <strong>
                {formatSignedOre(p.amount_ore)} {currency}
              </strong>
              <span className="badge">{d.statuses[p.status]}</span>
            </div>
            <p>
              {d.requestedAt}{' '}
              <time dateTime={p.requested_at}>{when(p.requested_at)}</time>
            </p>
            <details className="payout-history">
              <summary>{d.history}</summary>
              <p>
                {all.sellerPortal.source}: {all.sellerPortal[p.request_source]}
                {p.paid_at
                  ? ` · ${d.paidAt} ${when(p.paid_at)} · ${p.payment_reference}`
                  : ''}
              </p>
              {(events.get(p.id) ?? []).map((e) => (
                <small key={e.id}>
                  {when(e.occurred_at)} · {d.statuses[e.kind]}
                  {e.reason ? ` · ${e.reason}` : ''}
                  {e.reference ? ` · ${e.reference}` : ''}
                  <br />
                </small>
              ))}
            </details>
            {banks[p.id] && (
              <PayoutBankReview
                key={p.id}
                tenantId={active.id}
                payoutId={p.id}
                bank={banks[p.id]}
                status={p.status}
                d={all}
              />
            )}
            {write && (p.status === 'requested' || p.status === 'approved') && (
              <details className="payout-decision">
                <summary>
                  {p.status === 'requested' ? d.reviewRequest : d.recordPayment}
                </summary>
                {p.status === 'approved' && <p>{d.paymentHint}</p>}
                <PayoutDecision
                  key={`${p.id}-${p.status}`}
                  tenantId={active.id}
                  payoutId={p.id}
                  status={p.status}
                  d={d}
                  intake={all.intake}
                  leaveUnsaved={all.leaveUnsaved}
                />
              </details>
            )}
          </div>
        ))}
        {pager}
      </section>
    )
  }
  return (
    <div className="payouts-overview">
      <div className="page-heading workspace-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{
            label: d.helpLabel,
            steps: [d.intro, d.notice, d.settleReasonHint],
          }}
        />
        <Link
          className="btn btn-secondary"
          href="/intake/payouts/payment-sheet"
        >
          {all.payoutSheet.title}
        </Link>
      </div>
      <WorkspaceTabs
        id="payouts"
        label={d.title}
        tabs={[
          {
            id: 'open',
            label: d.tabs.open,
            content: (
              <>
                {flagged.length > 0 && (
                  <section className="card intake-form">
                    <h2>{all.returns.flaggedHeading}</h2>
                    <p>{all.returns.flaggedHint}</p>
                    {flagged.map((r) => (
                      <p key={r.id} role="alert">
                        {when(r.occurred_at)} · {formatSignedOre(r.refund_ore)}{' '}
                        {currency} · {r.reason} ·{' '}
                        <Link
                          className="text-link"
                          href={`/intake/items/${r.item_id}`}
                        >
                          {all.items.open}
                        </Link>
                      </p>
                    ))}
                  </section>
                )}
                {list('open', open.rows, open.count, openPage, openPages)}
              </>
            ),
          },
          {
            id: 'history',
            label: d.tabs.history,
            content: list(
              'history',
              history.rows,
              history.count,
              historyPage,
              historyPages,
            ),
          },
          ...(write
            ? [
                {
                  id: 'request',
                  label: d.tabs.request,
                  content: (
                    <section
                      className="card intake-form"
                      data-testid="payout-request"
                    >
                      <h2>{d.requestHeading}</h2>
                      <PayoutRequestForm
                        key={active.id}
                        tenantId={active.id}
                        currency={currency}
                        sellers={eligible}
                        d={d}
                        intake={all.intake}
                        leaveUnsaved={all.leaveUnsaved}
                      />
                      <p>
                        <Link className="text-link" href="/intake/sellers">
                          {d.directory}
                        </Link>
                      </p>
                    </section>
                  ),
                },
                {
                  id: 'prepare',
                  label: d.tabs.prepare,
                  content: (
                    <section
                      className="card intake-form"
                      data-testid="payout-settlement"
                    >
                      <h2>{d.settleHeading}</h2>
                      <p>{d.bankReviewHint}</p>
                      <p>
                        {d.settleHint.replace(
                          '{threshold}',
                          `${(settlement.thresholdOre / 100).toFixed(2)} ${currency}`,
                        )}
                      </p>
                      <SettlementForm
                        key={active.id}
                        tenantId={active.id}
                        currency={currency}
                        candidates={settlement.sellers}
                        d={d}
                        paging={all.sellersList}
                        intake={all.intake}
                        leaveUnsaved={all.leaveUnsaved}
                      />
                    </section>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.payouts.title)
