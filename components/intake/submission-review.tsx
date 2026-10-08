'use client'
import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'

export function SubmissionReview({
  tenantId,
  submissionId,
  d,
}: {
  tenantId: string
  submissionId: string
  d: Dictionary['submissions']
}) {
  const router = useRouter()
  const decisionId = useId()
  const pending = useRef<{
    requestId: string
    decision: string
    note: string
  } | null>(null)
  const running = useRef(false)
  const [decision, setDecision] = useState('invite')
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (running.current || saved) return
        if (!pending.current) {
          const data = new FormData(e.currentTarget)
          pending.current = {
            requestId: crypto.randomUUID(),
            decision,
            note: String(data.get('note')).trim(),
          }
        }
        running.current = true
        setBusy(true)
        setLocked(true)
        setError(false)
        try {
          const response = await fetch('/api/intake/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              submissionId,
              ...pending.current,
            }),
          })
          const result = await response.json()
          if (!response.ok || result.id !== pending.current.requestId)
            throw new Error('UNCONFIRMED')
          setSaved(true)
          router.refresh()
        } catch {
          setError(true)
        } finally {
          running.current = false
          setBusy(false)
        }
      }}
    >
      <fieldset disabled={locked} className="submission-fields">
        <div>
          <label htmlFor={decisionId}>{d.save}</label>
          <select
            id={decisionId}
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            {(['invite', 'more_information', 'decline'] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {d[value]}
                </option>
              ),
            )}
          </select>
        </div>
        <label>
          {d.note}
          <textarea
            name="note"
            maxLength={1000}
            required={decision === 'more_information'}
            rows={2}
          />
        </label>
      </fieldset>
      {!saved && (
        <button className="btn" disabled={busy} aria-busy={busy}>
          {busy ? '…' : locked ? d.retry : d.save}
        </button>
      )}
      {error && <p role="alert">{d.failure}</p>}
    </form>
  )
}
