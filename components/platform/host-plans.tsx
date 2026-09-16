'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import type { ActivityRow, PlanOverviewRow } from '@/lib/engine/plans'

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
      <h2>{d.hostTitle}</h2>
      <p>{d.hostIntro}</p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{d.store}</th>
              <th>{d.state}</th>
              <th>{d.provider}</th>
              <th>{d.until}</th>
              <th>{d.created}</th>
              <th>{d.members}</th>
              <th>{d.sellers}</th>
              <th>{d.items}</th>
              <th>{d.sales30}</th>
              <th>{d.lastActivity}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tenant_id}>
                <td>
                  {row.name} <small>{row.slug}</small>
                </td>
                <td>{d.states[row.state]}</td>
                <td>{row.provider}</td>
                <td>
                  {date(
                    row.state === 'trial'
                      ? row.trial_ends_at
                      : row.state === 'past_due'
                        ? row.grace_ends_at
                        : row.active_until,
                  )}
                </td>
                <td>{date(row.created_at)}</td>
                <td>{activity[row.tenant_id]?.members ?? ''}</td>
                <td>{activity[row.tenant_id]?.sellers ?? ''}</td>
                <td>{activity[row.tenant_id]?.items ?? ''}</td>
                <td>{activity[row.tenant_id]?.sales_30d ?? ''}</td>
                <td>{date(activity[row.tenant_id]?.last_activity ?? null)}</td>
                <td>
                  {row.state !== 'closed' && (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setTarget(row)}
                    >
                      {d.activate}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <form
          className="intake-fields"
          onSubmit={(e) => {
            e.preventDefault()
            void activate()
          }}
          aria-label={d.activateHeading.replace('{name}', target.name)}
        >
          <h3>{d.activateHeading.replace('{name}', target.name)}</h3>
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
