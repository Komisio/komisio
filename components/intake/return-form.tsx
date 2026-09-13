'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Full return of one sale line; the refund equals the line price in P2. */
export function ReturnForm({
  tenantId,
  saleLineId,
  refund,
  d,
  intake,
}: {
  tenantId: string
  saleLineId: string
  refund: string
  d: Dictionary['returns']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
    if (
      await action.run({
        action: 'recordReturn',
        tenantId,
        requestId,
        saleLineId,
        refund,
        reason,
      })
    ) {
      setDone(true)
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || done}
      >
        <div className="field">
          <label htmlFor={`return-reason-${saleLineId}`}>{d.reason}</label>
          <input
            id={`return-reason-${saleLineId}`}
            name="reason"
            required
            maxLength={500}
          />
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.confirm.replace('{amount}', refund)}
        </label>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {!done && (
        <Button type="submit" disabled={action.busy || action.needsReload}>
          {action.busy ? intake.busy : action.locked ? intake.retry : d.record}
        </Button>
      )}
      {done && <p role="status">{d.recorded}</p>}
    </form>
  )
}
