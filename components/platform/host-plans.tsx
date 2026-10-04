'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import {
  planStates,
  type ActivityRow,
  type PlanOverviewRow,
} from '@/lib/engine/plans'

/** Every store and its plan state, with manual activation for the host. */
export function HostPlans({
  rows,
  activity,
  locale,
  d,
}: {
  rows: PlanOverviewRow[]
  activity: Record<string, ActivityRow>
  locale: string
  d: Dictionary['plans']
}) {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [target, setTarget] = useState<PlanOverviewRow | null>(null)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')
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
  const date = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(intlLocale(locale), {
          timeZone: 'Europe/Stockholm',
        })
      : ''
  async function activate() {
    if (!target || running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const r = await fetch('/api/host', {
        method: 'POST',
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
      setError(errors.REQUEST_FAILED)
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
      <div className="host-stores">
        {filtered.length === 0 && <p role="status">{d.noStores}</p>}
        {filtered.map((row) => (
          <article
            className="host-store"
            key={row.tenant_id}
            aria-label={row.name}
          >
            <div className="host-store-heading">
              <h3>{row.name}</h3>
              <span className="host-state" data-state={row.state}>
                {d.states[row.state]}
              </span>
            </div>
            <dl className="host-store-stats">
              {(
                [
                  [d.members, activity[row.tenant_id]?.members],
                  [d.sellers, activity[row.tenant_id]?.sellers],
                  [d.items, activity[row.tenant_id]?.items],
                  [d.sales30, activity[row.tenant_id]?.sales_30d],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="host-last-activity">
              {d.lastActivity}:{' '}
              {date(activity[row.tenant_id]?.last_activity ?? null) || '—'}
            </p>
            <div className="host-store-actions">
              <details>
                <summary>{d.details}</summary>
                <dl className="host-store-detail">
                  <div>
                    <dt>{d.store}</dt>
                    <dd>{row.slug}</dd>
                  </div>
                  <div>
                    <dt>{d.provider}</dt>
                    <dd>{row.provider}</dd>
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
              </details>
              {row.state !== 'closed' && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setError('')
                    setUntil('')
                    setReason('')
                    setTarget(row)
                  }}
                >
                  {d.activate}
                </Button>
              )}
            </div>
          </article>
        ))}
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
          {error && <p role="alert">{error}</p>}
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
            <Button type="submit" disabled={busy || !reason.trim()}>
              {busy ? d.busy : d.confirmActivate}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTarget(null)}
              disabled={busy}
            >
              {d.cancel}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
