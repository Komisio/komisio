import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readPayouts,
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

export default async function Payouts() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.payouts
  const [payouts, balances, flagged, settlement] = await Promise.all([
    readPayouts(ctx.client, active.id),
    readPayoutRequestSellers(ctx.client, active.id),
    readFlaggedReturns(ctx.client, active.id),
    readSettlementCandidates(ctx.client, active.id),
  ])
  const events = await readPayoutEvents(
    ctx.client,
    active.id,
    payouts.map((p) => p.id),
  )
  const names = new Map(balances.map((s) => [s.id, s.name]))
  // The payout list is the newest 50 for any seller, while the name map above
  // covers the first 50 sellers by name; look up the names the list still
  // lacks so a payout never shows a raw id. A failed read is an error, not a
  // missing name.
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
  return (
    <div className="payouts-overview">
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <div className="payouts-workspace">
        {flagged.length > 0 && (
          <section className="card intake-form">
            <h2>{all.returns.flaggedHeading}</h2>
            <p>{all.returns.flaggedHint}</p>
            {flagged.map((r) => (
              <p key={r.id} role="alert">
                {when(r.occurred_at)} · {formatSignedOre(r.refund_ore)}{' '}
                {currency} · {r.reason} ·{' '}
                <Link className="text-link" href={`/intake/items/${r.item_id}`}>
                  {all.items.open}
                </Link>
              </p>
            ))}
          </section>
        )}
        <details
          className="card intake-form payout-disclosure"
          data-testid="payout-request"
        >
          <summary>
            <strong>{d.requestHeading}</strong>
          </summary>
          {!write ? (
            <p>{all.intake.readOnly}</p>
          ) : eligible.length > 0 ? (
            <>
              <p>{d.requestHint}</p>
              <PayoutRequestForm
                key={active.id}
                tenantId={active.id}
                currency={currency}
                sellers={eligible}
                d={d}
                intake={all.intake}
              />
            </>
          ) : (
            <p role="status">{d.requestNone}</p>
          )}
          <p>
            <Link className="text-link" href="/intake/sellers">
              {d.directory}
            </Link>
          </p>
        </details>
        <details
          className="card payout-disclosure"
          data-testid="payout-settlement"
        >
          <summary>
            <strong>{d.settleHeading}</strong>
          </summary>
          <section className="intake-form">
            <h2>{d.settleHeading}</h2>
            <p>
              {d.settleHint.replace(
                '{threshold}',
                `${(settlement.thresholdOre / 100).toFixed(2)} ${currency}`,
              )}
            </p>
            {settlement.sellers.length === 0 ? (
              <p>{d.settleEmpty}</p>
            ) : write ? (
              <SettlementForm
                key={`${active.id}-${settlement.sellers.map((s) => s.sellerId).join(',')}`}
                tenantId={active.id}
                currency={currency}
                candidates={settlement.sellers}
                d={d}
                intake={all.intake}
              />
            ) : (
              <p>{all.intake.readOnly}</p>
            )}
          </section>
        </details>
        <section
          className="card intake-form payout-register"
          data-testid="payout-list"
        >
          <h2>{d.list}</h2>
          {payouts.length === 0 && <p>{d.empty}</p>}
          {payouts.length >= 50 && (
            <p>
              <small>{d.latestFifty}</small>
            </p>
          )}
          {payouts.map((p) => (
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
                  {all.sellerPortal.source}:{' '}
                  {all.sellerPortal[p.request_source]}
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
              {write &&
                (p.status === 'requested' || p.status === 'approved') && (
                  <PayoutDecision
                    key={`${p.id}-${p.status}`}
                    tenantId={active.id}
                    payoutId={p.id}
                    status={p.status}
                    d={d}
                    intake={all.intake}
                  />
                )}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.payouts.title)
