'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
export function SubmissionReception({
  tenantId,
  submissionId,
  description,
  price,
  d,
}: {
  tenantId: string
  submissionId: string
  description: string
  price: string
  d: Dictionary['submissions']
}) {
  const router = useRouter(),
    pending = useRef<object | null>(null),
    running = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [locked, setLocked] = useState(false)
  return (
    <details>
      <summary>{d.prepareReception}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (running.current) return
          const data = new FormData(e.currentTarget)
          pending.current ??= {
            tenantId,
            submissionId,
            description: data.get('description'),
            price: data.get('price'),
          }
          running.current = true
          setBusy(true)
          setLocked(true)
          setError(false)
          try {
            const response = await fetch('/api/intake/submissions/reception', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pending.current),
            })
            const result = await response.json()
            if (
              !response.ok ||
              typeof result.sessionId !== 'string' ||
              !/^[a-f0-9-]{36}$/.test(result.sessionId)
            )
              throw Error()
            router.push(`/intake/reception/${result.sessionId}`)
          } catch {
            setError(true)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        <p>{d.receptionHint}</p>
        <fieldset className="submission-fields" disabled={locked}>
          <label>
            {d.descriptionLabel}
            <textarea
              name="description"
              defaultValue={description.slice(0, 1000)}
              maxLength={1000}
              required
              rows={3}
            />
          </label>
          <label>
            {d.receptionPrice}
            <input
              name="price"
              inputMode="decimal"
              defaultValue={price}
              required
              pattern="[0-9]+([.,][0-9]{1,2})?"
            />
          </label>
        </fieldset>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? '…' : locked ? d.retry : d.prepareReception}
        </button>
        {error && <p role="alert">{d.receptionFailed}</p>}
      </form>
    </details>
  )
}
