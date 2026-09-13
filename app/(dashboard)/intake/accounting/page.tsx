import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readDayCloses } from '@/lib/engine/day-closes'
import {
  readAccountingMap,
  readAccountingExports,
  previewVoucher,
} from '@/lib/engine/accounting'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { DayCloseForm } from '@/components/intake/day-close-form'
import { AccountMapForm } from '@/components/intake/account-map-form'
import { ExportDayClose } from '@/components/intake/export-day-close'

export default async function Accounting() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.accounting
  const [closes, map, exports] = await Promise.all([
    readDayCloses(ctx.client, active.id),
    readAccountingMap(ctx.client, active.id),
    readAccountingExports(ctx.client, active.id),
  ])
  // Preview the newest closes only; older ones are reachable through their exports.
  const previews = new Map(
    (
      await Promise.all(
        closes
          .slice(0, 10)
          .map((c) => previewVoucher(ctx.client, active.id, c.id)),
      )
    ).map((p) => [p.dayCloseId, p]),
  )
  const closeById = new Map(closes.map((c) => [c.id, c]))
  const today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
  })
  const money = (ore: number) => `${formatSignedOre(ore)} SEK`
  const vatModes = all.sales.vatModes as Record<string, string>
  const accountLabel = (key: string) => {
    if (key.startsWith('mode:')) {
      const [, mode, amount] = key.split(':')
      return `${vatModes[mode] ?? mode} · ${amount === 'netOre' ? d.netOf : d.vatOf}`
    }
    return d.amountKeys[key as keyof typeof d.amountKeys] ?? key
  }
  const canEditMap = ['owner', 'admin'].includes(active.role)
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
        <section className="card intake-form" aria-label={d.mapHeading}>
          <h2>{d.mapHeading}</h2>
          <p>{d.mapIntro}</p>
          <AccountMapForm
            key={`${active.id}-${map.id ?? 'none'}`}
            tenantId={active.id}
            current={map}
            editable={canEditMap}
            d={d}
            vatModes={vatModes}
            intake={all.intake}
          />
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
                  {vatModes[mode] ?? mode}: {t.lines} · {d.net}{' '}
                  {money(t.netOre)} · {d.vat} {money(t.vatOre)} · {d.gross}{' '}
                  {money(t.grossOre)}
                  <br />
                </small>
              ))}
              {previews.has(c.id) && (
                <ExportDayClose
                  key={`${c.id}-${map.id ?? 'none'}`}
                  tenantId={active.id}
                  preview={previews.get(c.id)!}
                  canExport={active.role !== 'readonly'}
                  money={money}
                  accountLabel={accountLabel}
                  d={d}
                  intake={all.intake}
                />
              )}
            </div>
          ))}
        </section>
        <section className="card intake-form" aria-label={d.exportsHeading}>
          <h2>{d.exportsHeading}</h2>
          {exports.length === 0 && <p>{d.noExports}</p>}
          {exports.map((e) => {
            const c = closeById.get(e.day_close_id)
            return (
              <p key={e.id}>
                {c
                  ? `${c.close_date} · ${d.version} ${c.version}`
                  : e.day_close_id}{' '}
                · {e.voucher.length} {d.lines} · {d.debitTotal}{' '}
                {money(e.debit_ore)} ·{' '}
                {new Date(e.created_at).toLocaleString(ctx.locale, {
                  timeZone: 'Europe/Stockholm',
                })}{' '}
                ·{' '}
                <a className="text-link" href={`/api/accounting/${e.id}`}>
                  {d.download}
                </a>
              </p>
            )
          })}
        </section>
      </div>
    </>
  )
}
