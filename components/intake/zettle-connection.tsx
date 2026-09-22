'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { PilotIssue } from '@/extensions/zettle/auth'
import type { Dictionary } from '@/lib/i18n'
export function ZettleConnection({
  tenantId,
  issue,
  setupAvailable,
  d,
}: {
  tenantId: string
  issue: PilotIssue | null
  setupAvailable: boolean
  d: Dictionary['zettle']
}) {
  const running = useRef(false)
  const router = useRouter()
  const [clientId, setClientId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false)
  async function check(connect = false) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/zettle/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          ...(connect ? { credentials: { clientId, apiKey } } : {}),
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(
          (d.errors as Record<string, string>)[body.error] ??
            d.connectionFailed,
        )
        return
      }
      if (
        typeof body.organizationId !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(body.organizationId)
      )
        throw new Error('Invalid result')
      setOk(true)
      if (connect) {
        setApiKey('')
        setClientId('')
        router.refresh()
      }
      setMessage(
        `${d.connectionVerified} ${body.organizationId}. ${body.merchantPinned ? d.merchantPinned : d.merchantUnpinned}`,
      )
    } catch {
      setMessage(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form" aria-label={d.connectionTitle}>
      <h2>{d.connectionTitle}</h2>
      <p>{d.connectionHint}</p>
      {issue === null ? (
        <Button type="button" onClick={() => void check()} disabled={busy}>
          {busy ? d.busy : d.checkConnection}
        </Button>
      ) : !setupAvailable ? (
        <div>
          <p role="status">{d[issue]}</p>
          <p>{d.connectionConfigHint}</p>
        </div>
      ) : null}
      {setupAvailable && (
        <details open={issue !== null}>
          <summary>{d.setup}</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void check(true)
            }}
          >
            <p>{d.setupHint}</p>
            <label>
              {d.clientId}
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                maxLength={4096}
                autoComplete="off"
              />
            </label>
            <label>
              {d.apiKey}
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                maxLength={32768}
                autoComplete="new-password"
              />
            </label>
            <Button
              type="submit"
              disabled={busy || !clientId.trim() || !apiKey.trim()}
            >
              {busy ? d.busy : d.connect}
            </Button>
          </form>
        </details>
      )}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
    </section>
  )
}
