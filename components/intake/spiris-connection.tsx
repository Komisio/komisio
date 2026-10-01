'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { SpirisIssue } from '@/extensions/spiris/auth'
import type { SpirisConnectionStatus } from '@/lib/engine/spiris-connection'
import { intlLocale, type Dictionary } from '@/lib/i18n'

/** Connect, check and disconnect the store's Spiris company; nothing is sent to Spiris here. */
export function SpirisConnection({
  tenantId,
  status,
  issue,
  canConnect,
  outcome,
  locale,
  d,
}: {
  tenantId: string
  status: SpirisConnectionStatus
  issue: SpirisIssue | null
  canConnect: boolean
  outcome: string | null
  locale: string
  d: Dictionary['spiris']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false),
    [company, setCompany] = useState('')
  const errors = d.errors as Record<string, string>
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), {
      timeZone: 'Europe/Stockholm',
    })
  async function post(action: 'check' | 'disconnect') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/spiris', {
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
        `${d.connectionVerified} ${body.companyName} (${d.organisationNumber} ${body.organisationNumber || '–'}, ${d.currency} ${body.currencyCode}).`,
      )
    } catch {
      setMessage(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section
      id="spiris-connection"
      className="card intake-form"
      aria-label={d.title}
    >
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      {outcome && (
        <p role={outcome === 'connected' ? 'status' : 'alert'}>
          {outcome === 'connected'
            ? d.connected
            : (errors[outcome] ?? d.connectionFailed)}
        </p>
      )}
      {status.connected ? (
        <p>
          {d.connectedTo} <strong>{status.companyName}</strong>
          {status.organisationNumber
            ? ` · ${d.organisationNumber} ${status.organisationNumber}`
            : ''}
          {status.currencyCode ? ` · ${d.currency} ${status.currencyCode}` : ''}
          {status.connectedAt
            ? ` · ${d.since} ${when(status.connectedAt)}`
            : ''}
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
            <form action="/api/integrations/spiris/connect" method="get">
              <input type="hidden" name="tenant" value={tenantId} />
              <label>
                {d.companyName}
                <input
                  name="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
              <Button type="submit" disabled={!company.trim()}>
                {d.connect}
              </Button>
            </form>
          )}
          {status.connected && (
            <>
              <a
                className="btn btn-secondary"
                href={`/api/integrations/spiris/connect?tenant=${tenantId}`}
              >
                {d.reconnect}
              </a>
              <Button
                type="button"
                onClick={() => void post('check')}
                disabled={busy}
              >
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
                ? ` · ${e.detail.reason === 'invalid_grant' ? errors.SPIRIS_REFRESH_INVALID_GRANT : e.detail.reason === 'save_failed' ? errors.SPIRIS_REFRESH_SAVE_FAILED : (errors[e.detail.reason] ?? e.detail.reason)}`
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
