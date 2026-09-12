'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from '@/components/intake/use-intake-action'
import { Button } from '@/components/ui/button'

export function RecordCustody({
  tenantId,
  sessionId,
  d,
  intake,
}: {
  tenantId: string
  sessionId: string
  d: Dictionary['reception']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const note = String(new FormData(event.currentTarget).get('note') ?? '')
    const id = await action.run({
      action: 'receiveGarment',
      tenantId,
      requestId,
      sessionId,
      note,
    })
    if (id) router.refresh()
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked}
      >
        <div className="field">
          <label htmlFor="custody-note">{d.custodyNote}</label>
          <input id="custody-note" name="note" maxLength={500} />
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.custodyConfirm}
        </label>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && (
        <a className="text-link" href={`/intake/reception/${sessionId}`}>
          {intake.reload}
        </a>
      )}
      <Button type="submit" disabled={action.busy || action.needsReload}>
        {action.busy
          ? intake.busy
          : action.locked
            ? intake.retry
            : d.custodyRecord}
      </Button>
    </form>
  )
}
