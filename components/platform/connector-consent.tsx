'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { ConnectorScope } from '@/lib/engine/connectors'

/** The consent screen: which store, which scopes, allow or deny. The answer sends the browser back to the assistant. */
export function ConnectorConsent({
  clientName,
  clientId,
  redirectUri,
  codeChallenge,
  state,
  stores,
  defaultStore,
  requested,
  deniedUrl,
  d,
}: {
  clientName: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state?: string
  stores: { id: string; name: string; plus: boolean }[]
  defaultStore: string
  requested: ConnectorScope[]
  deniedUrl: string
  d: Dictionary['connectors']
}) {
  const running = useRef(false)
  const [store, setStore] = useState(defaultStore)
  const [scopes, setScopes] = useState<ConnectorScope[]>(requested)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const toggle = (s: ConnectorScope) =>
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    )
  async function allow() {
    if (running.current || scopes.length === 0) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: store,
          clientId,
          redirectUri,
          scopes,
          codeChallenge,
          ...(state !== undefined ? { state } : {}),
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || typeof data.redirect !== 'string') {
        setMessage(
          data.error === 'PLAN_PLUS_REQUIRED' ? d.plusRequired : d.failed,
        )
        return
      }
      window.location.assign(data.redirect)
    } catch {
      setMessage(d.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const selected = stores.find((s) => s.id === store)
  return (
    <section className="card intake-form" aria-label={d.consent.title}>
      <h1>{d.consent.title}</h1>
      <p>{d.consent.intro.replace('{client}', clientName)}</p>
      <label>
        {d.consent.store}
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {selected && !selected.plus && <p role="status">{d.plusRequired}</p>}
      <fieldset>
        <legend>{d.consent.scopesHeading}</legend>
        {requested.map((s) => (
          <label key={s} className="row">
            <input
              type="checkbox"
              checked={scopes.includes(s)}
              onChange={() => toggle(s)}
            />
            {d.scopes[s]}
          </label>
        ))}
      </fieldset>
      <p>{d.consent.note}</p>
      <div className="row">
        <Button onClick={allow} disabled={busy || scopes.length === 0}>
          {busy ? d.consent.working : d.consent.allow}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => window.location.assign(deniedUrl)}
        >
          {d.consent.deny}
        </Button>
      </div>
      {message && <p role="alert">{message}</p>}
    </section>
  )
}
