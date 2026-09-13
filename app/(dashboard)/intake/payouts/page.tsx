import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readPayouts,
  readPayoutEvents,
  readSettlementCandidates,
} from '@/lib/engine/payouts'
import { readFlaggedReturns } from '@/lib/engine/returns'
import { readSellerBalance, formatSignedOre } from '@/lib/engine/seller-ledger'
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
  const sellers = await ctx.client
    .from('sellers')
    .select('id,name')
    .eq('tenant_id', active.id)
    .order('name')
    .limit(50)
  if (sellers.error) throw new Error('Unable to read sellers')
  const sellerRows = z
    .array(z.object({ id: z.uuid(), name: z.string() }))
    .parse(sellers.data)
  const [payouts, balances, flagged, settlement] = await Promise.all([
    readPayouts(ctx.client, active.id),
    Promise.all(
      sellerRows.map(async (s) => ({
        ...s,
        availableOre: (await readSellerBalance(ctx.client, active.id, s.id))
          .availableOre,
      })),
    ),
    readFlaggedReturns(ctx.client, active.id),
    readSettlementCandidates(ctx.client, active.id),
  ])
  const events = await readPayoutEvents(
    ctx.client,
    active.id,
    payouts.map((p) => p.id),
  )
  const names = new Map(sellerRows.map((s) => [s.id, s.name]))
  const write = active.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <div className="intake-grid">
        <section className="card intake-form">
          <h2>{d.requestHeading}</h2>
          <p>{d.requestHint}</p>
          {write ? (
            <PayoutRequestForm
              key={active.id}
              tenantId={active.id}
              currency={currency}
              sellers={balances.filter((s) => s.availableOre > 0)}
              d={d}
              intake={all.intake}
            />
          ) : (
            <p>{all.intake.readOnly}</p>
          )}
        </section>
        <section className="card intake-form">
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
        <section className="card intake-form">
          <h2>{d.list}</h2>
          {payouts.length === 0 && <p>{d.empty}</p>}
          {payouts.map((p) => (
            <div key={p.id} className="intake-notice">
              <strong>
                {formatSignedOre(p.amount_ore)} {currency} ·{' '}
                <Link
                  className="text-link"
                  href={`/intake/sellers/${p.seller_id}`}
                >
                  {names.get(p.seller_id) ?? p.seller_id}
                </Link>{' '}
                · {d.statuses[p.status]}
              </strong>
              <p>
                {d.requestedAt} {when(p.requested_at)} ·{' '}
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
    </>
  )
}
