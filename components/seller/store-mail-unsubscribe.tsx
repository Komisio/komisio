'use client'
import { useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
export function StoreMailUnsubscribe({ d }: { d: Dictionary['storeMail'] }) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState(false)
  return (
    <section className="card">
      <h1>{d.unsubscribe}</h1>
      <p>{done ? d.unsubscribed : d.unsubscribeHint}</p>
      {!done && (
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(false)
            try {
              const [messageId, token] = window.location.hash
                .slice(1)
                .split('.')
              const r = await fetch('/api/store-mail/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId, token }),
              })
              const data = await r.json()
              if (r.ok && data.ok) {
                setDone(true)
                window.history.replaceState(
                  null,
                  '',
                  window.location.pathname + window.location.search,
                )
              } else setError(true)
            } catch {
              setError(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          {d.unsubscribe}
        </button>
      )}
      {error && <p role="alert">{d.invalidLink}</p>}
    </section>
  )
}
