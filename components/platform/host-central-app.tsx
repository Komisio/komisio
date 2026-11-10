'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useBusyState } from './work-activity'
import type { Dictionary } from '@/lib/i18n'
import type { CentralAppSettings } from '@/lib/engine/central-app-intake'

export function HostCentralApp({
  initial,
  stores,
  d,
}: {
  initial: CentralAppSettings
  stores: { id: string; name: string }[]
  d: Dictionary['centralApp']
}) {
  const [saved, setSaved] = useState(initial)
  const [tenant, setTenant] = useState(initial.tenantId ?? '')
  const [busy, setBusy] = useBusyState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const locked = useRef(false)
  async function save() {
    if (locked.current || uncertain) return
    locked.current = true
    setBusy(true)
    setError('')
    setSuccess(false)
    try {
      const r = await fetch('/api/host', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'centralAppIntake',
          id: crypto.randomUUID(),
          expected: saved.revision,
          tenantId: tenant || null,
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(
          body.error === 'SEK_REQUIRED'
            ? d.sekRequired
            : body.error === 'REQUEST_CHANGED'
              ? d.changed
              : d.failed,
        )
        if (body.error === 'REQUEST_CHANGED') setUncertain(true)
        return
      }
      if (
        typeof body.revision !== 'string' ||
        body.tenantId !== (tenant || null)
      )
        throw new Error('Unconfirmed')
      setSaved(body)
      setSuccess(true)
    } catch {
      setError(d.uncertain)
      setUncertain(true)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <details className="card intake-form">
      <summary>{d.title}</summary>
      <form
        className="intake-fields"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p>{d.intro}</p>
        <div className="field">
          <label htmlFor="central-app-recipient">{d.recipient}</label>
          <select
            id="central-app-recipient"
            value={tenant}
            disabled={busy || uncertain}
            onChange={(e) => {
              setTenant(e.target.value)
              setSuccess(false)
              setError('')
            }}
          >
            <option value="">{d.paused}</option>
            {saved.tenantId && !stores.some((s) => s.id === saved.tenantId) && (
              <option value={saved.tenantId}>{d.otherRecipient}</option>
            )}
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <small>{d.hint}</small>
        </div>
        {error && <p role="alert">{error}</p>}
        {success && <p role="status">{d.saved}</p>}
        {uncertain ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            {d.reload}
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={busy || tenant === (saved.tenantId ?? '')}
          >
            {busy ? d.busy : d.save}
          </Button>
        )}
      </form>
    </details>
  )
}
