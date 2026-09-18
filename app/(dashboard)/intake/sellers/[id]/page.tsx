import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readEffectiveSellerTerms,
  readSellerTermsHistory,
} from '@/lib/engine/seller-terms'
import { SellerTermsForm } from '@/components/intake/seller-terms-form'
import { LedgerAdjustForm } from '@/components/intake/ledger-adjust-form'
import { StatementForm } from '@/components/intake/statement-form'
import { readSellerStatements } from '@/lib/engine/statements'
import { readSellerCommunications } from '@/lib/engine/communications'
import { readPayouts } from '@/lib/engine/payouts'
import { readItems } from '@/lib/engine/items'
import { CommunicationForm } from '@/components/intake/communication-form'
import { PrintJobButton } from '@/components/intake/print-job-button'
import { readPrinters } from '@/lib/engine/printing'
import {
  readSellerBalance,
  readSellerLedger,
  formatSignedOre,
} from '@/lib/engine/seller-ledger'

export default async function Seller({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    tenant = ctx.active!,
    currency = await readStoreCurrency(ctx.client, tenant.id),
    all = dictionary(ctx.locale),
    d = all.sellerTerms
  const seller = await ctx.client
    .from('sellers')
    .select('id,name,email,phone,created_at')
    .eq('tenant_id', tenant.id)
    .eq('id', id.data)
    .maybeSingle()
  if (seller.error) throw new Error('Unable to read seller')
  if (!seller.data) notFound()
  const [
    terms,
    history,
    balance,
    ledger,
    statements,
    communications,
    payouts,
    items,
  ] = await Promise.all([
    readEffectiveSellerTerms(ctx.client, tenant.id, id.data),
    readSellerTermsHistory(ctx.client, tenant.id, id.data),
    readSellerBalance(ctx.client, tenant.id, id.data),
    readSellerLedger(ctx.client, tenant.id, id.data),
    readSellerStatements(ctx.client, tenant.id, id.data),
    readSellerCommunications(ctx.client, tenant.id, id.data),
    readPayouts(ctx.client, tenant.id, id.data),
    readItems(ctx.client, tenant.id),
  ])
  const c = all.communications
  const printers = await readPrinters(ctx.client, tenant.id)
  const sellerItems = items.filter((i) => i.seller_id === id.data)
  const soldLines = await ctx.client
    .from('sale_lines')
    .select('id,item_id,seller_credit_ore')
    .eq('tenant_id', tenant.id)
    .in(
      'item_id',
      sellerItems.map((i) => i.id),
    )
    .limit(50)
  const references = {
    item_accepted: sellerItems.map((i) => ({
      id: i.id,
      label: `${all.items.originKinds[i.origin_kind]} · ${i.id.slice(0, 8)}`,
    })),
    item_sold: (soldLines.data ?? []).map((l) => ({
      id: String(l.id),
      label: `${all.items.originKinds[sellerItems.find((i) => i.id === l.item_id)?.origin_kind ?? 'purchase']} · ${formatSignedOre(Number(l.seller_credit_ore))} ${currency}`,
    })),
    payout_approved: payouts
      .filter((p) => p.status === 'approved')
      .map((p) => ({
        id: p.id,
        label: `${formatSignedOre(p.amount_ore)} ${currency}`,
      })),
    payout_paid: payouts
      .filter((p) => p.status === 'paid')
      .map((p) => ({
        id: p.id,
        label: `${formatSignedOre(p.amount_ore)} ${currency} · ${p.payment_reference}`,
      })),
    statement_issued: statements.map((s) => ({
      id: s.id,
      label: `${s.kind === 'credit_note' ? all.statements.creditNote : all.statements.statement} ${s.number}`,
    })),
  }
  const l = all.ledger,
    st = all.statements
  const today = new Date(),
    monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const isoDay = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const write = tenant.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <div className="seller-profile">
      <Link className="text-link" href="/intake/sellers">
        ← {all.sellersList.title}
      </Link>
      <div className="page-heading">
        <div className="eyebrow">{tenant.name}</div>
        <h1>{seller.data.name}</h1>
        <div className="seller-contact">
          {seller.data.email && (
            <a href={`mailto:${seller.data.email}`}>{seller.data.email}</a>
          )}
          {seller.data.phone && (
            <a href={`tel:${seller.data.phone}`}>{seller.data.phone}</a>
          )}
        </div>
      </div>
      <div className="seller-overview">
        <section className="card intake-form seller-economy">
          <h2>{all.sellerProfile.balance}</h2>

          <dl className="seller-balances">
            {[
              [l.available, balance.availableOre],
              [l.reserved, balance.reservedOre],
              [l.credited, balance.creditedOre],
              [l.paid, balance.paidOre],
            ].map(([label, amount], index) => (
              <div
                key={String(label)}
                className={index === 0 ? 'seller-balance-primary' : ''}
              >
                <dt>{label}</dt>
                <dd>
                  {formatSignedOre(Number(amount))} {currency}
                </dd>
              </div>
            ))}
          </dl>
          <details className="seller-disclosure">
            <summary>
              {all.sellerProfile.transactions} <span>{ledger.length}</span>
            </summary>
            <div className="seller-disclosure-body">
              {ledger.length === 0 && <p>{l.empty}</p>}
              {ledger.map((e) => (
                <p key={e.id}>
                  {when(e.occurred_at)} · {l.kinds[e.kind]} ·{' '}
                  {formatSignedOre(e.amount_ore)} {currency}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
              ))}
            </div>
          </details>
          {['owner', 'admin'].includes(tenant.role) && (
            <details className="seller-disclosure">
              <summary>{l.adjustHeading}</summary>
              <div className="seller-disclosure-body">
                <LedgerAdjustForm
                  tenantId={tenant.id}
                  sellerId={id.data}
                  d={l}
                  intake={all.intake}
                />
              </div>
            </details>
          )}
        </section>
        <section className="card intake-form">
          <h2>{d.effective}</h2>

          <p role="status">
            <strong>
              {d.commissionRatePercent}: {terms.commissionRatePercent} %
            </strong>{' '}
            ·{' '}
            {terms.overrides.commissionRatePercent ? d.override : d.fromPolicy}
          </p>
          <p role="status">
            <strong>
              {d.commissionBasis}: {d[terms.commissionBasis]}
            </strong>{' '}
            · {terms.overrides.commissionBasis ? d.override : d.fromPolicy}
          </p>
          {terms.notes && <p>{terms.notes}</p>}

          {write && (
            <details className="seller-disclosure">
              <summary>{all.sellerProfile.editTerms}</summary>
              <div className="seller-disclosure-body">
                <p>{d.intro}</p>
                <p>{d.publishHint}</p>
                <SellerTermsForm
                  key={terms.sellerTermsId ?? 'none'}
                  tenantId={tenant.id}
                  sellerId={id.data}
                  current={terms}
                  d={d}
                  intake={all.intake}
                />
              </div>
            </details>
          )}
        </section>
      </div>
      <details className="card seller-section">
        <summary>{st.title}</summary>
        <div className="seller-disclosure-body">
          {statements.length === 0 && <p>{st.empty}</p>}
          {statements.map((s) => (
            <p key={s.id}>
              <Link className="text-link" href={`/intake/statements/${s.id}`}>
                {s.kind === 'credit_note' ? st.creditNote : st.statement}{' '}
                {s.number}
              </Link>{' '}
              · {when(s.period_from)} – {when(s.period_to)} · {st.closing}{' '}
              {formatSignedOre(s.closing_ore)} {currency}
            </p>
          ))}
          {write && (
            <>
              <h3>{st.issueHeading}</h3>
              <p>{st.issueHint}</p>
              <StatementForm
                tenantId={tenant.id}
                sellerId={id.data}
                defaultFrom={isoDay(monthStart)}
                defaultTo={isoDay(today)}
                d={st}
                intake={all.intake}
              />
            </>
          )}
        </div>
      </details>
      {write && (
        <details className="card seller-section">
          <summary>{all.printing.onboardingSlip}</summary>
          <div className="seller-disclosure-body">
            <p>{all.printing.onboardingHint}</p>
            <PrintJobButton
              tenantId={tenant.id}
              printers={printers}
              kind="onboarding"
              referenceKind="seller"
              referenceId={id.data}
              d={all.printing}
              intake={all.intake}
            />
          </div>
        </details>
      )}
      <details className="card seller-section">
        <summary>{c.title}</summary>
        <div className="seller-disclosure-body">
          {communications.length === 0 && <p>{c.empty}</p>}
          {communications.map((m) => (
            <details key={m.id}>
              <summary>
                {when(m.queued_at)} · {c.kinds[m.kind]} · {c.outcomes[m.status]}{' '}
                · {m.subject}
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{m.body}</pre>
            </details>
          ))}
          {write && (
            <>
              <h3>{c.sendHeading}</h3>

              <CommunicationForm
                tenantId={tenant.id}
                sellerId={id.data}
                references={references}
                d={c}
                intake={all.intake}
              />
            </>
          )}
        </div>
      </details>
      <details className="card seller-section">
        <summary>{d.history}</summary>
        <div className="seller-disclosure-body">
          {history.length === 0 && <p>{d.noHistory}</p>}
          {history.map((v) => (
            <p key={v.id}>
              {d.version} {v.version} · {when(v.created_at)} ·{' '}
              {v.commission_rate_percent === null
                ? d.usePolicy
                : `${v.commission_rate_percent} %`}{' '}
              · {v.commission_basis ? d[v.commission_basis] : d.usePolicy}
              {v.notes ? ` · ${v.notes}` : ''}
            </p>
          ))}
        </div>
      </details>
      {['owner', 'admin'].includes(tenant.role) && (
        <p>
          <a className="text-link" href={`/api/sellers/${id.data}/export`}>
            {all.intake.exportSellerData}
          </a>
        </p>
      )}
    </div>
  )
}
