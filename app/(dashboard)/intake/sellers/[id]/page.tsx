import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readEffectiveSellerTerms,
  readSellerTermsHistory,
} from '@/lib/engine/seller-terms'
import { SellerTermsForm } from '@/components/intake/seller-terms-form'
import { LedgerAdjustForm } from '@/components/intake/ledger-adjust-form'
import { StatementForm } from '@/components/intake/statement-form'
import { readSellerStatements } from '@/lib/engine/statements'
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
  const [terms, history, balance, ledger, statements] = await Promise.all([
    readEffectiveSellerTerms(ctx.client, tenant.id, id.data),
    readSellerTermsHistory(ctx.client, tenant.id, id.data),
    readSellerBalance(ctx.client, tenant.id, id.data),
    readSellerLedger(ctx.client, tenant.id, id.data),
    readSellerStatements(ctx.client, tenant.id, id.data),
  ])
  const l = all.ledger,
    st = all.statements
  const today = new Date(),
    monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const isoDay = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const write = tenant.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <>
      <Link className="text-link" href="/intake">
        {all.intake.back}
      </Link>
      <div className="page-heading">
        <div className="eyebrow">{tenant.name}</div>
        <h1>{seller.data.name}</h1>
        <p>
          {d.contact}: {seller.data.email || seller.data.phone}
        </p>
      </div>
      <section className="card intake-form">
        <h2>{d.effective}</h2>
        <p>{d.intro}</p>
        <p role="status">
          <strong>
            {d.commissionRatePercent}: {terms.commissionRatePercent} %
          </strong>{' '}
          · {terms.overrides.commissionRatePercent ? d.override : d.fromPolicy}
        </p>
        <p role="status">
          <strong>
            {d.commissionBasis}: {d[terms.commissionBasis]}
          </strong>{' '}
          · {terms.overrides.commissionBasis ? d.override : d.fromPolicy}
        </p>
        <p>
          {terms.sellerTermsId ? `${d.version} ${terms.version}` : d.noVersion}
          {terms.notes ? ` · ${terms.notes}` : ''}
        </p>
        <p>
          <Link className="text-link" href="/settings">
            {d.policyLink} {terms.storePolicyVersion}
          </Link>
        </p>
      </section>
      {write && (
        <section className="card intake-form">
          <h2>{d.publishHeading}</h2>
          <p>{d.publishHint}</p>
          <SellerTermsForm
            key={terms.sellerTermsId ?? 'none'}
            tenantId={tenant.id}
            sellerId={id.data}
            current={terms}
            d={d}
            intake={all.intake}
          />
        </section>
      )}
      <section className="card intake-form">
        <h2>{l.title}</h2>
        <p>{l.intro}</p>
        <p role="status">
          <strong>
            {l.available}: {formatSignedOre(balance.availableOre)} SEK
          </strong>{' '}
          · {l.reserved}: {formatSignedOre(balance.reservedOre)} SEK ·{' '}
          {l.credited}: {formatSignedOre(balance.creditedOre)} SEK · {l.paid}:{' '}
          {formatSignedOre(balance.paidOre)} SEK
        </p>
        {ledger.length === 0 && <p>{l.empty}</p>}
        {ledger.map((e) => (
          <p key={e.id}>
            {when(e.occurred_at)} · {l.kinds[e.kind]} ·{' '}
            {formatSignedOre(e.amount_ore)} SEK
            {e.reason ? ` · ${e.reason}` : ''}
          </p>
        ))}
        {['owner', 'admin'].includes(tenant.role) && (
          <>
            <h3>{l.adjustHeading}</h3>
            <p>{l.adjustHint}</p>
            <LedgerAdjustForm
              tenantId={tenant.id}
              sellerId={id.data}
              d={l}
              intake={all.intake}
            />
          </>
        )}
      </section>
      <section className="card intake-form">
        <h2>{st.title}</h2>
        <p>{st.intro}</p>
        {statements.length === 0 && <p>{st.empty}</p>}
        {statements.map((s) => (
          <p key={s.id}>
            <Link className="text-link" href={`/intake/statements/${s.id}`}>
              {s.kind === 'credit_note' ? st.creditNote : st.statement}{' '}
              {s.number}
            </Link>{' '}
            · {when(s.period_from)} – {when(s.period_to)} · {st.closing}{' '}
            {formatSignedOre(s.closing_ore)} SEK
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
      </section>
      <section className="card intake-form">
        <h2>{d.history}</h2>
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
      </section>
    </>
  )
}
