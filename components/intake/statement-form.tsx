'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { statementPeriodDates } from '@/lib/intake/statement-period'
import { issueStatementCommand } from '@/lib/engine/statements'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Issues the next numbered statement for a seller over a closed period. */
export function StatementForm({
  tenantId,
  sellerId,
  defaultFrom,
  defaultTo,
  d,
  intake,
}: {
  tenantId: string
  sellerId: string
  defaultFrom: string
  defaultTo: string
  d: Dictionary['statements']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [invalid, setInvalid] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    let bounds
    try {
      bounds = statementPeriodDates(
        String(f.get('from') ?? ''),
        String(f.get('to') ?? ''),
      )
    } catch {
      setInvalid(true)
      return
    }
    const candidate = issueStatementCommand.safeParse({
      action: 'issueStatement',
      tenantId,
      requestId,
      sellerId,
      ...bounds,
      correctsId: null,
    })
    setInvalid(!candidate.success)
    if (!candidate.success) return
    const id = await action.run(candidate.data)
    if (id) {
      setIssued(id)
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
          <label htmlFor="statement-from">{d.from}</label>
          <input
            id="statement-from"
            name="from"
            type="date"
            required
            max={defaultTo}
            defaultValue={defaultFrom}
          />
        </div>
        <div className="field">
          <label htmlFor="statement-to">{d.to}</label>
          <input
            id="statement-to"
            name="to"
            type="date"
            required
            max={defaultTo}
            defaultValue={defaultTo}
          />
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
        {action.busy ? intake.busy : action.locked ? intake.retry : d.issue}
      </Button>
      {issued && (
        <p role="status">
          {d.issued}{' '}
          <a className="text-link" href={`/intake/statements/${issued}`}>
            {d.open}
          </a>
        </p>
      )}
    </form>
  )
}
