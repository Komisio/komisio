'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import {
  planStates,
  type ActivityRow,
  type PlanOverviewRow,
} from '@/lib/engine/plans'
import {
  hostStoreColumns,
  sortHostStores,
  type HostStoreColumn,
} from '@/lib/platform/host-store-table'

/** Every store and its plan state, with manual activation for the host. */
export function HostPlans({
  rows,
  billingEnabled,
  activity,
  locale,
  d,
}: {
  billingEnabled: boolean
  rows: PlanOverviewRow[]
  activity: Record<string, ActivityRow>
  locale: string
  d: Dictionary['plans']
}) {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [target, setTarget] = useState<PlanOverviewRow | null>(null)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<HostStoreColumn>('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const activationHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (target) activationHeading.current?.focus()
  }, [target])
  const filtered = rows.filter(
    (row) =>
      (!state || row.state === state) &&
      `${row.name} ${row.slug}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  )
  const errors = d.errors as Record<string, string>
  const sorted = sortHostStores(
    filtered,
    activity,
    sort,
    direction,
    intlLocale(locale),
    d.states,
  )
  const columnLabels = {
    name: d.store,
    state: d.state,
    sellers: d.sellers,
    items: d.items,
    sales30: d.sales30,
    lastActivity: d.lastActivity,
  }
  const date = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(intlLocale(locale), {
          timeZone: 'Europe/Stockholm',
        })
      : ''
  async function activate() {
    if (!target || running.current || uncertain || !billingEnabled) return
    running.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const r = await fetch('/api/host', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activatePlan',
          tenantId: target.tenant_id,
          until: until
            ? new Date(`${until}T23:59:59+02:00`).toISOString()
            : null,
          reason,
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(errors[body.error] ?? errors.REQUEST_FAILED)
        return
      }
      setMessage(d.activated.replace('{name}', target.name))
      setTarget(null)
      setReason('')
      setUntil('')
      router.refresh()
    } catch {
      setError(d.activationUnconfirmed)
      setUncertain(true)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form" aria-label={d.hostTitle}>
      <div className="host-section-heading">
        <h2>
          {d.hostTitle} <span className="host-count">{rows.length}</span>
        </h2>
      </div>
      <p>{d.subscriptionHint}</p>
      {!billingEnabled && <p role="status">{d.errors.BILLING_DISABLED}</p>}
      <div className="host-filters">
        <div className="field">
          <label htmlFor="host-search">{d.searchStores}</label>
          <input
            id="host-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="host-state">{d.state}</label>
          <select
            id="host-state"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">{d.allStates}</option>
            {planStates.map((value) => (
              <option key={value} value={value}>
                {d.states[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      <p className="host-results" role="status">
        {d.tableCount
          .replace('{count}', String(filtered.length))
          .replace('{total}', String(rows.length))}
      </p>
      <p className="host-table-hint" id="host-table-hint">
        {d.tableHint}
      </p>
      <div
        className="host-table-scroll"
        role="region"
        aria-label={d.storeTable}
        tabIndex={0}
      >
        <table className="host-store-table" aria-describedby="host-table-hint">
          <caption className="sr-only">{d.storeTable}</caption>
          <thead>
            <tr>
              {hostStoreColumns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  aria-sort={
                    sort === column
                      ? direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort(column)
                      setDirection(
                        sort === column && direction === 'asc' ? 'desc' : 'asc',
                      )
                    }}
                  >
                    {columnLabels[column]}{' '}
                    <span aria-hidden="true">
                      {sort === column
                        ? direction === 'asc'
                          ? '↑'
                          : '↓'
                        : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={hostStoreColumns.length}>{d.noStores}</td>
              </tr>
            )}
            {sorted.map((row) => {
              const isOpen = expanded === row.tenant_id
              const toggle = () => setExpanded(isOpen ? null : row.tenant_id)
              return (
                <Fragment key={row.tenant_id}>
                  <tr
                    className="host-store-row"
                    data-expanded={isOpen}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button, a'))
                        return
                      if (window.getSelection()?.toString()) return
                      toggle()
                    }}
                  >
                    <th scope="row">
                      <button
                        className="host-store-name"
                        type="button"
                        onClick={toggle}
                        aria-expanded={isOpen}
                        aria-controls={`host-detail-${row.tenant_id}`}
                      >
                        <ChevronDown size={16} aria-hidden="true" />
                        <span className="host-store-label">
                          <span>{row.name}</span>
                          <span className="host-slug">{row.slug}</span>
                        </span>
                      </button>
                    </th>
                    <td>
                      <span className="host-state" data-state={row.state}>
                        {d.states[row.state]}
                      </span>
                    </td>
                    <td>{activity[row.tenant_id]?.sellers ?? '—'}</td>
                    <td>{activity[row.tenant_id]?.items ?? '—'}</td>
                    <td>{activity[row.tenant_id]?.sales_30d ?? '—'}</td>
                    <td>
                      {date(activity[row.tenant_id]?.last_activity ?? null) ||
                        '—'}
                    </td>
                  </tr>
                  <tr
                    id={`host-detail-${row.tenant_id}`}
                    hidden={!isOpen}
                    className="host-detail-row"
                  >
                    <td colSpan={hostStoreColumns.length}>
                      {isOpen && (
                        <section
                          aria-label={row.name}
                          className="host-store-expanded"
                        >
                          <h3>{row.name}</h3>
                          <dl className="host-store-detail">
                            <div>
                              <dt>{d.members}</dt>
                              <dd>{activity[row.tenant_id]?.members ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>{d.store}</dt>
                              <dd>{row.slug}</dd>
                            </div>
                            <div>
                              <dt>{d.state}</dt>
                              <dd>{d.states[row.state]}</dd>
                            </div>
                            <div>
                              <dt>{d.provider}</dt>
                              <dd>{d.providers[row.provider]}</dd>
                            </div>
                            <div>
                              <dt>{d.created}</dt>
                              <dd>{date(row.created_at)}</dd>
                            </div>
                            <div>
                              <dt>{d.until}</dt>
                              <dd>
                                {date(
                                  row.state === 'trial'
                                    ? row.trial_ends_at
                                    : row.state === 'past_due'
                                      ? row.grace_ends_at
                                      : row.active_until,
                                ) || '—'}
                              </dd>
                            </div>
                          </dl>
                          <details className="host-manual-plan">
                            <summary>{d.activate}</summary>
                            <p>{d.activationHint}</p>
                            {!billingEnabled ? (
                              <p>{d.errors.BILLING_DISABLED}</p>
                            ) : row.state !== 'closed' ? (
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busy || uncertain}
                                onClick={() => {
                                  setError('')
                                  setUntil('')
                                  setReason('')
                                  setTarget(row)
                                }}
                              >
                                {d.editPlan}
                              </Button>
                            ) : (
                              <p>{d.errors.PLAN_CLOSED}</p>
                            )}
                          </details>
                        </section>
                      )}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {target && (
        <form
          className="intake-fields host-activation"
          onSubmit={(e) => {
            e.preventDefault()
            void activate()
          }}
          aria-label={d.activateHeading.replace('{name}', target.name)}
        >
          <h3 ref={activationHeading} tabIndex={-1}>
            {d.activateHeading.replace('{name}', target.name)}
          </h3>
          <p>{d.activationHint}</p>
          {error && <p role="alert">{error}</p>}
          {uncertain && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {d.reloadStatus}
            </Button>
          )}
          <div className="field">
            <label htmlFor="plan-until">{d.untilOptional}</label>
            <input
              id="plan-until"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="plan-reason">{d.reason}</label>
            <input
              id="plan-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="row wrap">
            <Button
              type="submit"
              disabled={busy || uncertain || !reason.trim()}
            >
              {busy ? d.busy : d.confirmActivate}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTarget(null)}
              disabled={busy || uncertain}
            >
              {d.cancel}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
