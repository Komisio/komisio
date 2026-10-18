'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { ConsentState } from '@/lib/engine/store-mail'
export function StoreMailConsent({
  tenantId,
  sellerId,
  current,
  d,
}: {
  tenantId: string
  sellerId: string
  current: ConsentState
  d: Dictionary['storeMail']
}) {
  const [enabled, setEnabled] = useState(current.enabled),
    [busy, setBusy] = useBusyState(false),
    [message, setMessage] = useState(''),
    [locked, setLocked] = useState(false)
  const pending = useRef<object | null>(null),
    router = useRouter(),
    running = useRef(false)
  return (
    <details className="card" id="store-mail-consent">
      <summary>{d.consentTitle}</summary>
      <p id="store-mail-hint">{d.consentHint}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (running.current) return
          running.current = true
          setBusy(true)
          setMessage('')
          setLocked(true)
          pending.current ??= {
            action: 'consent',
            tenantId,
            sellerId,
            requestId: crypto.randomUUID(),
            expected: current.id,
            enabled,
          }
          try {
            const r = await fetch('/api/store-mail', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pending.current),
            })
            if (!r.ok) {
              setMessage(d.changed)
              return
            }
            pending.current = null
            setMessage(d.saved)
            router.refresh()
          } catch {
            setMessage(d.error)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || locked}
            aria-describedby="store-mail-hint"
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {d.consentLabel}
        </label>
        <button
          className="btn btn-secondary"
          disabled={busy || enabled === current.enabled}
        >
          {d.save}
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  )
}
