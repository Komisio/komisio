'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

type Option = { id: string; label: string }
type D = Dictionary['communications']

/** Sends one templated message to the seller through the communication log. */
export function CommunicationForm({
  tenantId,
  sellerId,
  references,
  d,
  intake,
}: {
  tenantId: string
  sellerId: string
  references: {
    item_accepted: Option[]
    item_sold: Option[]
    payout_approved: Option[]
    payout_paid: Option[]
    statement_issued: Option[]
  }
  d: D
  intake: Dictionary['intake']
}) {
  const router = useRouter()
  const [kind, setKind] = useState<keyof typeof references | 'message'>(
    'message',
  )
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId,
          sellerId,
          kind,
          referenceId: kind === 'message' ? null : String(f.get('reference')),
          freeText: String(f.get('freeText') ?? ''),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(
          result.error === 'SELLER_EMAIL_MISSING'
            ? d.noEmail
            : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
              ? intake.denied
              : intake.failed,
        )
        return
      }
      setOutcome(result.delivery)
      setRequestId(crypto.randomUUID())
      router.refresh()
    } catch {
      setError(intake.retry)
    } finally {
      setBusy(false)
    }
  }
  const options = kind === 'message' ? [] : references[kind]
  return (
    <form onSubmit={submit}>
      <fieldset className="intake-fields" disabled={busy}>
        <div className="field">
          <label htmlFor="communication-kind">{d.kind}</label>
          <select
            id="communication-kind"
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind)
              setOutcome(null)
            }}
          >
            {(
              [
                'message',
                'item_accepted',
                'item_sold',
                'payout_approved',
                'payout_paid',
                'statement_issued',
              ] as const
            ).map((k) => (
              <option key={k} value={k}>
                {d.kinds[k]}
              </option>
            ))}
          </select>
        </div>
        {kind !== 'message' && (
          <div className="field">
            <label htmlFor="communication-reference">{d.reference}</label>
            {options.length === 0 ? (
              <p>{d.noReference}</p>
            ) : (
              <select id="communication-reference" name="reference" required>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="communication-text">{d.freeText}</label>
          <textarea
            id="communication-text"
            name="freeText"
            maxLength={1000}
            rows={4}
          />
          <small>{d.freeTextHint}</small>
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.confirm}
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <Button
        type="submit"
        disabled={busy || (kind !== 'message' && options.length === 0)}
      >
        {busy ? intake.busy : d.send}
      </Button>
      {outcome && (
        <p role="status">
          {d.outcomes[outcome as keyof D['outcomes']] ?? outcome}
        </p>
      )}
    </form>
  )
}
