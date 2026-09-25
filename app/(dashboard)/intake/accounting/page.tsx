import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
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
import { FortnoxConnection } from '@/components/intake/fortnox-connection'
import { readFortnoxStatus } from '@/lib/engine/fortnox-connection'
import { fortnoxEnvironment, fortnoxIssue } from '@/extensions/fortnox/auth'
import { FortnoxVoucherSend } from '@/components/intake/fortnox-voucher-send'
import { FortnoxReconcile } from '@/components/intake/fortnox-reconcile'
import { readFortnoxSends } from '@/lib/engine/fortnox-vouchers'
import { readAutomaticFortnoxStatus } from '@/lib/engine/fortnox-automation'
import { automationIdentity, readAutomation } from '@/lib/engine/automation'
import { AutomationSwitch } from '@/components/intake/automation-switch'
import { currentMonthPeriod, economyPeriod } from '@/lib/engine/economy'
import { openDays, readReconciliation } from '@/lib/engine/reconciliation'

const views = ['days', 'reconciliation', 'settings'] as const
type View = (typeof views)[number]

/**
 * Three views on one page: the day's work (close, export, send), the
 * reconciliation for a period, and the settings (account map, Fortnox).
 * Only the selected view's data beyond the shared reads is fetched.
 */
export default async function Accounting({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const query = await searchParams
  const view: View = views.includes(query.view as View)
    ? (query.view as View)
    : 'days'
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.accounting
  const [closes, map, exports, fortnox, sends] = await Promise.all([
    readDayCloses(ctx.client, active.id),
    readAccountingMap(ctx.client, active.id),
    readAccountingExports(ctx.client, active.id),
    readFortnoxStatus(ctx.client, active.id),
    readFortnoxSends(ctx.client, active.id),
  ])
  const requestedPeriod = economyPeriod.safeParse({
    from: query.from,
    to: query.to,
  })
  const automatic =
    view === 'settings'
      ? await readAutomaticFortnoxStatus(ctx.client, active.id)
      : null
  const grants =
    view === 'settings' && ['owner', 'admin'].includes(active.role)
      ? await readAutomation(ctx.client, active.id)
      : null
  const period = requestedPeriod.success
    ? requestedPeriod.data
    : currentMonthPeriod()
  const recon =
    view === 'reconciliation'
      ? await readReconciliation(ctx.client, active.id, period)
      : null
  const attention = recon ? openDays(recon) : []
  const fortnoxOutcome =
    typeof query.fortnox === 'string' && /^[A-Za-z_]{1,40}$/.test(query.fortnox)
      ? query.fortnox
      : null
  // Preview the newest closes only; older ones are reachable through their exports.
  const previews = new Map(
    view === 'days'
      ? (
          await Promise.all(
            closes
              .slice(0, 10)
              .map((c) => previewVoucher(ctx.client, active.id, c.id)),
          )
        ).map((p) => [p.dayCloseId, p])
      : [],
  )
  const closeById = new Map(closes.map((c) => [c.id, c]))
  const today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
  })
  const money = (ore: number) => `${formatSignedOre(ore)} ${currency}`
  const vatModes = all.sales.vatModes as Record<string, string>
  const canEditMap = ['owner', 'admin'].includes(active.role)
  const attentionCount = recon ? attention.length : null
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <nav className="view-tabs" aria-label={d.viewsLabel}>
        {views.map((v) => (
          <Link
            key={v}
            href={
              v === 'days'
                ? '/intake/accounting'
                : `/intake/accounting?view=${v}`
            }
            className={`view-tab ${view === v ? 'active' : ''}`}
            aria-current={view === v ? 'page' : undefined}
          >
            {d.views[v]}
            {v === 'reconciliation' &&
            attentionCount !== null &&
            attentionCount > 0
              ? ` (${attentionCount})`
              : ''}
          </Link>
        ))}
      </nav>
      {view === 'days' && (
        <>
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
              {!map.id && (
                <p>
                  <Link
                    className="text-link"
                    href="/intake/accounting?view=settings"
                  >
                    {d.mapMissingLink}
                  </Link>
                </p>
              )}
            </section>
            <section className="card intake-form" aria-label={d.list}>
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
                      currency={currency}
                      preview={previews.get(c.id)!}
                      canExport={active.role !== 'readonly'}
                      vatModes={vatModes}
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
                const send = sends.get(e.id)
                return (
                  <div key={e.id} className="stack">
                    <p>
                      {c
                        ? `${c.close_date} · ${d.version} ${c.version}`
                        : e.day_close_id}{' '}
                      · {d.mapVersion} {e.accounting_maps?.version ?? '?'} ·{' '}
                      {e.voucher.length} {d.lines} · {d.debitTotal}{' '}
                      {money(e.debit_ore)} ·{' '}
                      {new Date(e.created_at).toLocaleString(ctx.locale, {
                        timeZone: 'Europe/Stockholm',
                      })}{' '}
                      ·{' '}
                      <a className="text-link" href={`/api/accounting/${e.id}`}>
                        {d.download}
                      </a>{' '}
                      ·{' '}
                      <FortnoxVoucherSend
                        key={`${e.id}-${send?.id ?? 'none'}-${send?.status ?? 'none'}`}
                        tenantId={active.id}
                        exportId={e.id}
                        send={send ?? null}
                        connected={fortnox.connected}
                        canSend={canEditMap}
                        d={all.fortnox}
                      />
                    </p>
                    {active.role === 'owner' &&
                      send &&
                      (send.status === 'pending' ||
                        (send.status === 'failed' &&
                          send.error_code === 'FORTNOX_OUTCOME_UNKNOWN')) && (
                        <FortnoxReconcile
                          tenantId={active.id}
                          send={send}
                          d={all.fortnox}
                        />
                      )}
                  </div>
                )
              })}
            </section>
          </div>
        </>
      )}
      {view === 'reconciliation' && (
        <div className="intake-grid">
          <section
            className="card intake-form"
            aria-label={all.reconciliation.heading}
          >
            <h2>{all.reconciliation.heading}</h2>
            <p>{all.reconciliation.hint}</p>
            <form method="get" className="intake-fields">
              <input type="hidden" name="view" value="reconciliation" />
              {!requestedPeriod.success && (query.from || query.to) && (
                <p role="alert">{all.reconciliation.periodInvalid}</p>
              )}
              <div className="field">
                <label htmlFor="recon-from">{all.reconciliation.from}</label>
                <input
                  id="recon-from"
                  name="from"
                  type="date"
                  defaultValue={period.from}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="recon-to">{all.reconciliation.to}</label>
                <input
                  id="recon-to"
                  name="to"
                  type="date"
                  defaultValue={period.to}
                  required
                />
              </div>
              <button className="btn btn-primary">
                {all.reconciliation.show}
              </button>
            </form>
            {recon && recon.days.length === 0 && (
              <p>{all.reconciliation.empty}</p>
            )}
            {recon && recon.days.length > 0 && attention.length === 0 && (
              <p role="status">{all.reconciliation.allDone}</p>
            )}
            {attention.length > 0 && (
              <>
                <h3>
                  {all.reconciliation.openDays} ({attention.length})
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{all.economy.date}</th>
                        <th>{all.economy.sales}</th>
                        <th>{all.economy.gross}</th>
                        <th>{all.reconciliation.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attention.map((day) => (
                        <tr key={day.date}>
                          <td>{day.date}</td>
                          <td>{day.salesCount}</td>
                          <td>{money(day.grossOre)}</td>
                          <td>
                            {all.reconciliation.statuses[day.status]}
                            {day.send?.errorCode
                              ? ` · ${(all.fortnox.errors as Record<string, string>)[day.send.errorCode] ?? day.send.errorCode}`
                              : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {view === 'settings' && (
        <div className="intake-grid">
          {['owner', 'admin'].includes(active.role) && (
            <AutomationSwitch
              key={active.id}
              tenantId={active.id}
              scope="fortnox_send"
              grants={grants}
              configured={
                !!automationIdentity() &&
                automatic?.available === true &&
                grants !== null
              }
              canEdit={active.role === 'owner'}
              t={all.fortnox.automation}
            />
          )}
          <p>
            {all.fortnox.automation.lastRun}:{' '}
            {automatic?.run
              ? `${automatic.run.at} · ${all.fortnox.automation[automatic.run.outcome]} · ${automatic.run.sent}`
              : all.fortnox.automation.noRun}
          </p>
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
          <FortnoxConnection
            key={`${active.id}-${fortnox.refreshedAt ?? 'none'}`}
            tenantId={active.id}
            status={fortnox}
            issue={fortnoxIssue(active.id, fortnoxEnvironment(process.env))}
            canConnect={canEditMap}
            outcome={fortnoxOutcome}
            locale={ctx.locale}
            d={all.fortnox}
          />
        </div>
      )}
    </>
  )
}
