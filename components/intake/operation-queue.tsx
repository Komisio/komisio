'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { PendingOperation } from '@/lib/engine/operations'
import { Button } from '@/components/ui/button'
type D = Dictionary['operations']

function Decision({
  tenantId,
  operation,
  d,
}: {
  tenantId: string
  operation: PendingOperation
  d: D
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(false)
  // One request ID per decision attempt; a retry of a lost response reuses it.
  const requestId = useRef(crypto.randomUUID())
  const running = useRef(false)
  async function decide(decision: 'approve' | 'reject', reason: string) {
    if (running.current || reload) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: requestId.current,
          operationId: operation.id,
          decision,
          reason,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(
          result.error === 'OPERATION_DECIDED'
            ? d.alreadyDecided
            : result.error === 'OPERATION_EXPIRED'
              ? d.expired
              : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
                ? d.denied
                : d.failed,
        )
        setReload(true)
        return
      }
      router.refresh()
    } catch {
      setError(d.retry)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className="intake-fields"
      onSubmit={(event) => {
        event.preventDefault()
        const reason = String(
          new FormData(event.currentTarget).get('reason') ?? '',
        )
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        decide(
          submitter?.getAttribute('value') === 'reject' ? 'reject' : 'approve',
          reason,
        )
      }}
    >
      <div className="field">
        <label htmlFor={`reason-${operation.id}`}>{d.reason}</label>
        <input id={`reason-${operation.id}`} name="reason" maxLength={500} />
      </div>
      <label className="intake-confirm">
        <input type="checkbox" name="checked" required />
        {d.confirm}
      </label>
      {error && <p role="alert">{error}</p>}
      {reload ? (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {d.reload}
        </Button>
      ) : (
        <div className="row">
          <Button type="submit" value="approve" disabled={busy}>
            {busy ? d.busy : d.approve}
          </Button>
          <Button
            type="submit"
            value="reject"
            variant="secondary"
            disabled={busy}
          >
            {d.reject}
          </Button>
        </div>
      )}
    </form>
  )
}

export function OperationQueue({
  tenantId,
  operations,
  canDecide,
  locale,
  d,
}: {
  tenantId: string
  operations: PendingOperation[]
  canDecide: boolean
  locale: string
  d: D
}) {
  const format = (value: string) =>
    new Date(value).toLocaleString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <ul className="intake-list">
      {operations.map((o) => (
        <li key={o.id} className="card intake-form">
          <span className="badge">{d.status[o.status]}</span>
          <h2>{d.kinds[o.kind]}</h2>
          <p>
            {d.proposedBy}: {o.actor_label} · {format(o.created_at)}
            <br />
            {d.riskLevel}: {d.risk[o.risk_level]} · {d.validUntil}:{' '}
            {format(o.expires_at)}
          </p>
          <p>
            <Link
              className="text-link"
              href={`/intake/reception/${o.payload.sessionId}`}
            >
              {d.openReception}
            </Link>{' '}
            · {d.sourceRevision} {o.payload.sourceRevision}
          </p>
          <dl className="operation-facts">
            {Object.entries(o.payload.suggestions.metadata).map(
              ([key, fact]) =>
                fact ? (
                  <div key={key}>
                    <dt>{d.fields[key as keyof D['fields']]}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ) : null,
            )}
            {o.payload.suggestions.price && (
              <div>
                <dt>{d.price}</dt>
                <dd>
                  {o.payload.suggestions.price.amount} SEK ·{' '}
                  {o.payload.suggestions.price.rationale}
                </dd>
              </div>
            )}
          </dl>
          {o.status === 'open' && canDecide && (
            <Decision tenantId={tenantId} operation={o} d={d} />
          )}
          {o.outcome && (
            <p>
              {d.decided}: {d.status[o.status]}
              {o.decided_at ? ` · ${format(o.decided_at)}` : ''}
              {o.reason ? ` · ${o.reason}` : ''}
              {o.outcome === 'failed' && o.error_code
                ? ` · ${o.error_code}`
                : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
