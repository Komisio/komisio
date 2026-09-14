'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { FortnoxIssue } from '@/extensions/fortnox/auth'
import type { FortnoxConnectionStatus } from '@/lib/engine/fortnox-connection'
import type { Dictionary } from '@/lib/i18n'

/** Connect, check and disconnect the store's Fortnox company; nothing is sent to Fortnox here. */
export function FortnoxConnection({
  tenantId,
  status,
  issue,
  canConnect,
  outcome,
  locale,
  d,
}: {
  tenantId: string
  status: FortnoxConnectionStatus
  issue: FortnoxIssue | null
  canConnect: boolean
  outcome: string | null
  locale: string
  d: Dictionary['fortnox']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false)
  const errors = d.errors as Record<string, string>
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  async function post(action: 'check' | 'disconnect') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/fortnox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(errors[body.error] ?? d.connectionFailed)
        return
      }
      setOk(true)
      if (action === 'disconnect') {
        setMessage(d.disconnected)
        window.location.reload()
        return
      }
      setMessage(
        `${d.connectionVerified} ${body.companyName} (${d.databaseNumber} ${body.databaseNumber}). ${body.pinnedDatabase ? d.databasePinned : d.databaseUnpinned}`,
      )
    } catch {
      setMessage(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      {outcome && (
        <p role={outcome === 'connected' ? 'status' : 'alert'}>
          {outcome === 'connected' ? d.connected : (errors[outcome] ?? d.connectionFailed)}
        </p>
      )}
      {status.connected ? (
        <p>
          {d.connectedTo} <strong>{status.companyName}</strong> ·{' '}
          {d.databaseNumber} {status.databaseNumber}
          {status.connectedAt ? ` · ${d.since} ${when(status.connectedAt)}` : ''}
        </p>
      ) : (
        <p>{d.notConnected}</p>
      )}
      {issue !== null ? (
        <div>
          <p role="status">{d[issue]}</p>
          <p>{d.configHint}</p>
        </div>
      ) : canConnect ? (
        <div className="row wrap">
          {!status.connected && (
            <a
              className="btn"
              href={`/api/integrations/fortnox/connect?tenant=${tenantId}`}
            >
              {d.connect}
            </a>
          )}
          {status.connected && (
            <>
              <Button type="button" onClick={() => void post('check')} disabled={busy}>
                {busy ? d.busy : d.check}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void post('disconnect')}
                disabled={busy}
              >
                {d.disconnect}
              </Button>
            </>
          )}
        </div>
      ) : (
        <p>{d.ownerOnly}</p>
      )}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
      {status.events.length > 0 && (
        <ul>
          {status.events.map((e, i) => (
            <li key={i}>
              {when(e.occurredAt)} · {d.events[e.kind]}
              {typeof e.detail.company_name === 'string'
                ? ` · ${e.detail.company_name}`
                : ''}
              {typeof e.detail.reason === 'string'
                ? ` · ${errors[e.detail.reason] ?? e.detail.reason}`
                : ''}
            </li>
          ))}
        </ul>
      )}
      <p>
        <small>{d.notice}</small>
      </p>
    </section>
  )
}
