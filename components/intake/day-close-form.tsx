'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Generates (or confirms) the close for one local day. */
export function DayCloseForm({
  tenantId,
  defaultDate,
  d,
  intake,
}: {
  tenantId: string
  defaultDate: string
  d: Dictionary['accounting']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const date = String(new FormData(event.currentTarget).get('date') ?? '')
    if (
      await action.run({
        action: 'generateDayClose',
        tenantId,
        requestId,
        date,
      })
    ) {
      setDone(true)
      setRequestId(crypto.randomUUID())
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
          <label htmlFor="close-date">{d.date}</label>
          <input
            id="close-date"
            name="date"
            type="date"
            required
            defaultValue={defaultDate}
          />
        </div>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      <Button type="submit" disabled={action.busy || action.needsReload}>
        {action.busy ? intake.busy : action.locked ? intake.retry : d.generate}
      </Button>
      {done && <p role="status">{d.generated}</p>}
    </form>
  )
}
