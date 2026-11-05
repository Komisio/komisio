'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'

export function HostSupportStart({
  tenantId,
  name,
  d,
  disabled = false,
}: {
  tenantId: string
  name: string
  d: Dictionary['hostSupport']
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const command = useRef<object | null>(null)
  const running = useRef(false)
  const inputId = `support-reason-${tenantId}`
  async function start() {
    if (running.current || disabled) return
    running.current = true
    setBusy(true)
    setError('')
    command.current ??= {
      action: 'start',
      id: crypto.randomUUID(),
      tenantId,
      reason,
    }
    try {
      const response = await fetch('/api/host/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.current),
        signal: AbortSignal.timeout(15000),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(
          d.errors[body.error as keyof typeof d.errors] ??
            d.errors.REQUEST_FAILED,
        )
        if (!uncertain) command.current = null
        return
      }
      // A full navigation discards cached membership layouts and editable drafts.
      window.location.assign(
        body.support?.available ? '/intake/sellers' : '/support',
      )
    } catch {
      setUncertain(true)
      setError(d.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {d.open}
      </Button>
    )
  return (
    <form
      className="host-support-start"
      aria-label={d.heading.replace('{name}', name)}
      onSubmit={(event) => {
        event.preventDefault()
        void start()
      }}
    >
      <h3>{d.heading.replace('{name}', name)}</h3>
      <p>{d.intro}</p>
      <div className="field">
        <label htmlFor={inputId}>{d.reason}</label>
        <input
          id={inputId}
          autoFocus
          required
          maxLength={500}
          value={reason}
          disabled={busy || uncertain}
          onChange={(event) => setReason(event.target.value)}
          aria-describedby={`${inputId}-hint`}
        />
        <small id={`${inputId}-hint`}>{d.reasonHint}</small>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="row wrap">
        <Button type="submit" disabled={busy || !reason.trim()}>
          {busy ? d.working : uncertain ? d.retry : d.start}
        </Button>
        {!uncertain && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {d.cancel}
          </Button>
        )}
        {uncertain && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => window.location.reload()}
          >
            {d.reload}
          </Button>
        )}
      </div>
    </form>
  )
}
