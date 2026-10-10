import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { FortnoxGuide } from '@/components/help/fortnox-guide'
import { ContextHelp } from '@/components/help/context-help'
import { credentialKeyConfigured } from '@/lib/platform/credentials'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
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
import { readAutomaticDayCloseStatus } from '@/lib/engine/day-close-automation'
import { automationIdentity, readAutomation } from '@/lib/engine/automation'
import { AutomationSwitch } from '@/components/intake/automation-switch'
import { currentMonthPeriod, economyPeriod } from '@/lib/engine/economy'
import { openDays, readReconciliation } from '@/lib/engine/reconciliation'
import { AccountingRoutingPreview } from '@/components/intake/accounting-routing-preview'

const views = ['days', 'reconciliation', 'settings', 'planning'] as const
type View = (typeof views)[number]

/**
 * Daily work, reconciliation, settings and unsaved responsibility planning.
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
  const automaticCloses =
    view === 'settings' && ['owner', 'admin'].includes(active.role)
      ? await readAutomaticDayCloseStatus(ctx.client, active.id)
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
    view === 'days' || view === 'planning'
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
    <div className="accounting-page">
      <div className="page-heading">
        <h1>{d.title}</h1>
        {view !== 'settings' && <p>{d.intro}</p>}
      </div>
      <nav className="view-tabs" aria-label={d.viewsLabel}>
        {views
          .filter((v) => v !== 'planning')
          .map((v) => (
            <Link
              key={v}
              href={
                v === 'days'
                  ? '/intake/accounting'
                  : `/intake/accounting?view=${v}`
              }
              className={`view-tab ${view === v || (view === 'planning' && v === 'settings') ? 'active' : ''}`}
              aria-current={
                view === v
                  ? 'page'
                  : view === 'planning' && v === 'settings'
                    ? 'location'
                    : undefined
              }
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
      {view === 'planning' && (
        <AccountingRoutingPreview
          key={active.id}
          previews={Array.from(previews.values())}
          currency={currency}
          d={all.accountingRouting}
          accounting={d}
          currencyWarning={all.helpCenter.guide.currency}
        />
      )}
      {view === 'days' && (
        <>
          <div className="accounting-workspace">
            <section className="card intake-form accounting-create">
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
                <div key={c.id} className="accounting-record">
                  <div className="accounting-record-heading">
                    <h3>{c.close_date}</h3>
                    <strong>{money(c.gross_ore)}</strong>
                  </div>
                  <p className="accounting-record-meta">
                    {d.sales}: {c.sales_count} · {d.version} {c.version}
                  </p>
                  <details className="accounting-breakdown">
                    <summary>{d.details}</summary>
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
                        {money(t.netOre)} · {d.vat} {money(t.vatOre)} ·{' '}
                        {d.gross} {money(t.grossOre)}
                        <br />
                      </small>
                    ))}
                  </details>
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
            <section
              className="card intake-form accounting-exports"
              aria-label={d.exportsHeading}
            >
              <div className="accounting-section-heading">
                <h2>{d.exportsHeading}</h2>
                <Link
                  className="text-link"
                  href="/intake/accounting?view=settings#accounting-systems"
                >
                  {d.systems}
                </Link>
              </div>
              <p>{d.deliveryHint}</p>
              {exports.length === 0 && <p>{d.noExports}</p>}
              {exports.map((e) => {
                const c = closeById.get(e.day_close_id)
                const send = sends.get(e.id)
                return (
                  <div key={e.id} className="accounting-record">
                    <div className="accounting-record-heading">
                      <h3>{c ? c.close_date : d.exportsHeading}</h3>
                      <Link
                        className="text-link"
                        href={`/intake/accounting/exports/${e.id}`}
                      >
                        {d.openExport}
                      </Link>
                      <a
                        className="btn btn-secondary"
                        href={`/api/accounting/${e.id}`}
                      >
                        {d.download}
                      </a>
                    </div>
                    <p className="accounting-record-meta">
                      {c ? `${d.version} ${c.version} · ` : ''}
                      {d.mapVersion} {e.accounting_maps?.version ?? '?'} ·{' '}
                      {e.voucher.length} {d.lines}
                    </p>
                    <details className="accounting-breakdown">
                      <summary>{d.details}</summary>
                      <p>
                        {d.debitTotal} {money(e.debit_ore)} ·{' '}
                        {new Date(e.created_at).toLocaleString(
                          intlLocale(ctx.locale),
                          {
                            timeZone: 'Europe/Stockholm',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          },
                        )}
                      </p>
                      {!c && <p>{e.day_close_id}</p>}
                    </details>
                    {(fortnox.connected || send) && (
                      <div className="accounting-delivery">
                        <h4>Fortnox</h4>
                        <FortnoxVoucherSend
                          key={`${e.id}-${send?.id ?? 'none'}-${send?.status ?? 'none'}`}
                          tenantId={active.id}
                          exportId={e.id}
                          send={send ?? null}
                          connected={fortnox.connected}
                          canSend={canEditMap}
                          d={all.fortnox}
                        />
                      </div>
                    )}
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
        <div className="accounting-reconciliation">
          <section
            className="card intake-form"
            aria-label={all.reconciliation.heading}
          >
            <h2>{all.reconciliation.heading}</h2>
            <p>{d.reconciliationHint}</p>
            <form method="get" className="economy-period-form">
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
                <div
                  className="economy-scroll"
                  role="group"
                  tabIndex={0}
                  aria-label={all.reconciliation.heading}
                >
                  <table className="economy-table">
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
                            <span>
                              {all.reconciliation.statuses[day.status]}
                              {day.send?.errorCode
                                ? ` · ${(all.fortnox.errors as Record<string, string>)[day.send.errorCode] ?? day.send.errorCode}`
                                : ''}
                            </span>
                            {day.export && (
                              <p>
                                <Link
                                  className="text-link"
                                  href={`/intake/accounting/exports/${day.export.id}`}
                                >
                                  {d.openExport}
                                </Link>
                              </p>
                            )}
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
        <>
          <div className="accounting-settings">
            {['owner', 'admin'].includes(active.role) && (
              <div id="day-close-automation">
                <AutomationSwitch
                  key={`day-close-${active.id}`}
                  tenantId={active.id}
                  scope="day_close"
                  grants={grants}
                  configured={
                    !!automationIdentity() &&
                    automaticCloses?.available === true &&
                    grants !== null
                  }
                  canEdit={active.role === 'owner'}
                  t={d.dayCloseAutomation}
                  help={{
                    label: d.dayCloseAutomation.help,
                    steps: [
                      d.dayCloseAutomation.helpScope,
                      d.dayCloseAutomation.helpDates,
                    ],
                  }}
                  lastRun={
                    automaticCloses?.run?.through
                      ? {
                          grantId: automaticCloses.run.grantId,
                          text: `${d.dayCloseAutomation.preparedThrough} ${new Intl.DateTimeFormat(intlLocale(ctx.locale), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${automaticCloses.run.through}T12:00:00Z`))}${automaticCloses.run.outcome === 'partial' ? ` · ${d.dayCloseAutomation.catchingUp}` : ''}`,
                        }
                      : null
                  }
                />
              </div>
            )}
            <section
              id="accounting-systems"
              aria-label={d.systems}
              className="accounting-systems"
            >
              <FormHelpHeading
                title={d.systems}
                help={{
                  label: d.setup.systemHelp,
                  steps: [d.deliveryHint, d.setup.systemHint],
                }}
              />
              <div className="card intake-form accounting-file-option">
                <h3>{d.fileOption}</h3>
                <p>{d.fileHint}</p>
                <Link className="text-link" href="/intake/accounting">
                  {d.exportsHeading}
                </Link>
              </div>
              <details
                className="card accounting-setting-disclosure accounting-provider-disclosure"
                open={!!fortnoxOutcome}
              >
                <summary>
                  <span>
                    <strong>Fortnox</strong>
                    <small>{d.setup.providerHint}</small>
                  </span>
                  <span className="accounting-setup-status">
                    {fortnox.connected
                      ? all.fortnox.connected
                      : d.setup.notConnected}
                  </span>
                </summary>
                <div className="accounting-provider">
                  <FortnoxConnection
                    key={`${active.id}-${fortnox.refreshedAt ?? 'none'}`}
                    tenantId={active.id}
                    status={fortnox}
                    issue={fortnoxIssue(
                      active.id,
                      fortnoxEnvironment(process.env),
                    )}
                    canConnect={canEditMap}
                    outcome={fortnoxOutcome}
                    locale={ctx.locale}
                    d={all.fortnox}
                  />
                  <FortnoxGuide
                    client={ctx.client}
                    tenantId={active.id}
                    role={active.role}
                    connection={fortnox}
                    ready={
                      fortnoxIssue(
                        active.id,
                        fortnoxEnvironment(process.env),
                      ) === null && credentialKeyConfigured(process.env)
                    }
                    d={all.helpCenter}
                    initiallyOpen={false}
                  />
                  <div id="fortnox-automation" className="stack">
                    {['owner', 'admin'].includes(active.role) && (
                      <AutomationSwitch
                        key={`automation-${active.id}`}
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
                    <ContextHelp
                      key={`automation-help-${active.id}`}
                      topic="fortnox-automation"
                      d={all.helpCenter}
                      label={
                        all.helpCenter.articles['fortnox-automation'].title
                      }
                    />
                  </div>
                </div>
              </details>
            </section>
            <details className="card accounting-setting-disclosure accounting-map-disclosure">
              <summary>
                <span>
                  <strong>{d.mapHeading}</strong>
                  <small>{d.setup.mapHint}</small>
                </span>
                <span className="accounting-setup-status">
                  {map.id
                    ? `${d.mapVersion} ${map.version}`
                    : d.setup.mapMissing}
                </span>
              </summary>
              <section
                id="account-map"
                className="card intake-form"
                aria-label={d.mapHeading}
              >
                <FormHelpHeading
                  title={d.mapHeading}
                  help={{ label: d.setup.mapHelp, steps: [d.mapIntro] }}
                />
                <Link className="text-link" href="#accounting-systems">
                  {d.systems} ↑
                </Link>
                <AccountMapForm
                  key={`${active.id}-${map.id ?? 'none'}`}
                  tenantId={active.id}
                  current={map}
                  editable={canEditMap}
                  d={d}
                  vatModes={vatModes}
                  intake={all.intake}
                  leaveUnsaved={all.leaveUnsaved}
                />
              </section>
            </details>
            <div className="accounting-setup-guidance">
              <Link
                className="text-link"
                href="/intake/accounting?view=planning"
              >
                {all.accountingRouting.simple.entry} →
              </Link>
              <p>{d.setup.planningHint}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.accounting.title)
