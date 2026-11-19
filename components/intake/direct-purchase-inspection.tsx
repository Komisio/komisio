'use client'
import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { useRouter } from '@/components/platform/use-working-router'
import { useBusyState } from '@/components/platform/work-activity'

export function DirectPurchaseInspection({
  tenantId,
  requestId,
  amount,
  d,
}: {
  tenantId: string
  requestId: string
  amount: string
  d: Dictionary['externalOffers']
}) {
  const router = useRouter()
  const [busy, setBusy] = useBusyState(false)
  const [outcome, setOutcome] = useState<
    'initial' | 'unknown' | 'changed' | 'saved'
  >('initial')
  const locked = useRef(false)
  const command = useRef<{ commandId: string; marginEligible: boolean } | null>(
    null,
  )
  const t = d.fixed
  if (outcome === 'saved') return <p role="status">{t.purchaseComplete}</p>
  if (outcome === 'changed')
    return (
      <div>
        <p role="alert">{d.changed}</p>
        <button type="button" onClick={() => router.refresh()}>
          {d.reload}
        </button>
      </div>
    )
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (locked.current) return
        if (!command.current) {
          const form = new FormData(e.currentTarget)
          if (
            !form.has('inspected') ||
            !['yes', 'no'].includes(String(form.get('evidence')))
          )
            return
          command.current = {
            commandId: crypto.randomUUID(),
            marginEligible: form.get('evidence') === 'yes',
          }
        }
        locked.current = true
        setBusy(true)
        try {
          const response = await fetch('/api/intake/requests/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, requestId, ...command.current }),
          })
          if (response.status === 409) {
            setOutcome('changed')
            return
          }
          const result = await response.json()
          if (
            !response.ok ||
            result.id !== command.current.commandId ||
            !result.purchaseId
          )
            throw new Error('UNCONFIRMED')
          setOutcome('saved')
          router.refresh()
        } catch {
          setOutcome('unknown')
        } finally {
          locked.current = false
          setBusy(false)
        }
      }}
    >
      <fieldset
        disabled={busy || outcome === 'unknown'}
        className="submission-fields"
      >
        <label>
          <input type="checkbox" name="inspected" required />{' '}
          {t.conditionChecked}
        </label>
        <label>
          {t.marginEvidence}
          <select name="evidence" required defaultValue="">
            <option disabled value="">
              —
            </option>
            <option value="yes">{t.confirmed}</option>
            <option value="no">{t.notConfirmed}</option>
          </select>
        </label>
      </fieldset>
      {outcome === 'unknown' ? <p role="alert">{d.failure}</p> : null}
      <button className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {outcome === 'unknown'
          ? d.retry
          : t.inspectBuy.replace('{amount}', amount)}
      </button>
    </form>
  )
}
