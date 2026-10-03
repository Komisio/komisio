'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

type Option = { id: string; label: string }
type D = Dictionary['communications']

/** Sends one templated message to the seller through the communication log. */
export function CommunicationForm({
  tenantId,
  sellerId,
  references,
  d,
  intake,
  leaveUnsaved,
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
  leaveUnsaved: string
}) {
  const router = useRouter()
  const [kind, setKind] = useState<keyof typeof references | 'message'>(
    'message',
  )
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<keyof D['outcomes'] | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const confirmation = useRef<HTMLInputElement>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const running = useRef(false)
  const pending = useRef<{
    tenantId: string
    requestId: string
    sellerId: string
    kind: typeof kind
    referenceId: string | null
    freeText: string
  } | null>(null)
  const { dirty, checkDirty, resetDirty } = useFormDirty(form)
  useUnsavedChanges(dirty || locked ? leaveUnsaved : null)
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (running.current || needsReload) return
    const f = new FormData(event.currentTarget)
    const command = pending.current ?? {
      tenantId,
      requestId: crypto.randomUUID(),
      sellerId,
      kind,
      referenceId: kind === 'message' ? null : String(f.get('reference')),
      freeText: String(f.get('freeText') ?? ''),
    }
    pending.current = command
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    setOutcome(null)
    try {
      const response = await fetch('/api/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        const answered = response.status >= 400 && response.status < 500
        const code = answered ? result?.error : 'REQUEST_FAILED'
        if (['INVALID_INPUT', 'EMAIL_DAILY_CAP'].includes(code)) {
          pending.current = null
          setLocked(false)
        } else if (
          [
            'SELLER_EMAIL_MISSING',
            'SELLER_NOT_FOUND',
            'REFERENCE_NOT_FOUND',
            'FORBIDDEN',
            'AUTH_REQUIRED',
            'TENANT_CHANGED',
            'REQUEST_CONFLICT',
          ].includes(code)
        ) {
          setNeedsReload(true)
        }
        setError(
          code === 'SELLER_EMAIL_MISSING'
            ? d.noEmail
            : code === 'EMAIL_DAILY_CAP'
              ? d.dailyCap
              : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(code)
                ? intake.denied
                : code === 'INVALID_INPUT'
                  ? intake.invalid
                  : [
                        'TENANT_CHANGED',
                        'REQUEST_CONFLICT',
                        'SELLER_NOT_FOUND',
                        'REFERENCE_NOT_FOUND',
                      ].includes(code)
                    ? intake.recordChanged
                    : intake.failed,
        )
        return
      }
      if (
        result?.ok !== true ||
        result.id !== command.requestId ||
        !Object.hasOwn(d.outcomes, result.delivery)
      )
        throw new Error('Unconfirmed communication response')
      setOutcome(result.delivery)
      pending.current = null
      setLocked(false)
      if (confirmation.current) confirmation.current.checked = false
      resetDirty()
      router.refresh()
    } catch {
      setError(intake.retry)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const options = kind === 'message' ? [] : references[kind]
  return (
    <form
      ref={form}
      onSubmit={submit}
      onChange={() => {
        checkDirty()
        setOutcome(null)
      }}
    >
      <fieldset className="intake-fields" disabled={busy || locked}>
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
          <input ref={confirmation} type="checkbox" required />
          {d.confirm}
        </label>
      </fieldset>
      {error && (
        <p ref={alert} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={
          busy ||
          needsReload ||
          (!locked && kind !== 'message' && options.length === 0)
        }
      >
        {busy ? intake.busy : locked ? intake.retry : d.send}
      </Button>
      {needsReload && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {intake.reload}
        </Button>
      )}
      {outcome && <p role="status">{d.outcomes[outcome]}</p>}
    </form>
  )
}
