'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { adjustSellerLedgerCommand } from '@/lib/engine/seller-ledger'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Owner or admin correction of a seller's ledger: a new signed entry with a reason. */
export function LedgerAdjustForm({
  tenantId,
  sellerId,
  d,
  intake,
}: {
  tenantId: string
  sellerId: string
  d: Dictionary['ledger']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      f = new FormData(form)
    const raw = String(f.get('amount') ?? '')
      .trim()
      .replace(',', '.')
    const amount = /^-?\d+$/.test(raw) ? `${raw}.00` : raw
    const candidate = adjustSellerLedgerCommand.safeParse({
      action: 'adjustSellerLedger',
      tenantId,
      requestId,
      sellerId,
      amount,
      reason: String(f.get('reason') ?? ''),
    })
    setInvalid(!candidate.success)
    if (!candidate.success) return
    if (await action.run(candidate.data)) {
      setSaved(true)
      setRequestId(crypto.randomUUID())
      form.reset()
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked}
      >
        <div className="field">
          <label htmlFor="ledger-amount">{d.amount}</label>
          <input
            id="ledger-amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="-50"
          />
          <small>{d.amountHint}</small>
        </div>
        <div className="field">
          <label htmlFor="ledger-reason">{d.reason}</label>
          <input id="ledger-reason" name="reason" required maxLength={500} />
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.confirm}
        </label>
      </fieldset>
      {(invalid || action.error) && (
        <p role="alert">{invalid ? intake.invalid : action.error}</p>
      )}
      <Button type="submit" disabled={action.busy || action.needsReload}>
        {action.busy ? intake.busy : action.locked ? intake.retry : d.adjust}
      </Button>
      {saved && <p role="status">{d.adjusted}</p>}
    </form>
  )
}
