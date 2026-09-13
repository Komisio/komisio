import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readDayCloses } from '@/lib/engine/day-closes'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { DayCloseForm } from '@/components/intake/day-close-form'

export default async function Accounting() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.accounting
  const closes = await readDayCloses(ctx.client, active.id)
  const today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
  })
  const money = (ore: number) => `${formatSignedOre(ore)} SEK`
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
          <h2>{d.generateHeading}</h2>
          <p>{d.generateHint}</p>
          {active.role !== 'readonly' ? (
            <DayCloseForm
              key={active.id}
              tenantId={active.id}
              defaultDate={today}
              d={d}
              intake={all.intake}
            />
          ) : (
            <p>{all.intake.readOnly}</p>
          )}
        </section>
        <section className="card intake-form">
          <h2>{d.list}</h2>
          {closes.length === 0 && <p>{d.empty}</p>}
          {closes.map((c) => (
            <div key={c.id} className="intake-notice">
              <strong>
                {c.close_date} · {d.version} {c.version} · {d.sales}{' '}
                {c.sales_count} · {money(c.gross_ore)}
              </strong>
              <p>
                {d.vat} {money(c.vat_ore)} · {d.commission}{' '}
                {money(c.commission_ore)}
                {c.commission_vat_ore > 0
                  ? ` (+ ${d.commissionVat} ${money(c.commission_vat_ore)})`
                  : ''}{' '}
                · {d.sellerCredit} {money(c.seller_credit_ore)}
              </p>
              <p>
                {d.returns} {c.returns_count} · {d.refunds}{' '}
                {money(c.refunds_ore)} · {d.creditReversed}{' '}
                {money(c.credit_reversed_ore)} · {d.payoutsPaid}{' '}
                {money(c.payouts_paid_ore)}
              </p>
              {Object.entries(c.per_mode).map(([mode, t]) => (
                <small key={mode}>
                  {all.sales.vatModes[
                    mode as keyof typeof all.sales.vatModes
                  ] ?? mode}
                  : {t.lines} · {d.net} {money(t.netOre)} · {d.vat}{' '}
                  {money(t.vatOre)} · {d.gross} {money(t.grossOre)}
                  <br />
                </small>
              ))}
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
