'use client'
import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { useRouter } from '@/components/platform/use-working-router'
import { Button } from '@/components/ui/button'

export function ItemPeriodCorrection({
  tenantId,
  itemId,
  endEventId,
  tomorrow,
  d,
  intake,
  actions,
}: {
  tenantId: string
  itemId: string
  endEventId: string
  tomorrow: string
  d: Dictionary['itemPeriod']
  intake: Dictionary['intake']
  actions: Dictionary['items']['eventDetails']['actions']
}) {
  const action = useIntakeAction(intake),
    router = useRouter()
  const [operation, setOperation] = useState('reopen')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState(false)
  const running = useRef(false)
  const blocked = action.busy || action.locked || action.needsReload
  async function submit(form: HTMLFormElement) {
    if (running.current || action.needsReload) return
    const f = new FormData(form)
    running.current = true
    setSaved(false)
    try {
      const common = {
        tenantId,
        itemId,
        requestId,
        expectedEndEventId: endEventId,
        reason: String(f.get('reason') ?? ''),
      }
      if (
        await action.run(
          operation === 'reopen'
            ? {
                ...common,
                action: 'reopenItemPeriod',
                saleEndsOn: String(f.get('saleEndsOn') ?? ''),
              }
            : {
                ...common,
                action: 'correctItemPeriodEnd',
                endAction: String(f.get('endAction') ?? ''),
              },
        )
      ) {
        setSaved(true)
        setRequestId(crypto.randomUUID())
        router.refresh()
      }
    } finally {
      running.current = false
    }
  }
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.description}</p>
      <details>
        <summary>{d.open}</summary>
        <form
          className="intake-fields"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(e.currentTarget)
          }}
        >
          <div className="field">
            <label htmlFor={`period-operation-${itemId}`}>{d.operation}</label>
            <select
              id={`period-operation-${itemId}`}
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              disabled={blocked}
            >
              <option value="reopen">{d.reopen}</option>
              <option value="correct">{d.correct}</option>
            </select>
          </div>
          {operation === 'reopen' ? (
            <div className="field">
              <label htmlFor={`period-end-${itemId}`}>{d.saleEndsOn}</label>
              <input
                id={`period-end-${itemId}`}
                name="saleEndsOn"
                type="date"
                min={tomorrow}
                max="9999-12-30"
                required
                disabled={blocked}
              />
              <small>{d.noFee}</small>
            </div>
          ) : (
            <div className="field">
              <label htmlFor={`period-action-${itemId}`}>{d.endAction}</label>
              <select
                id={`period-action-${itemId}`}
                name="endAction"
                defaultValue=""
                required
                disabled={blocked}
              >
                <option value="" disabled>
                  {d.choose}
                </option>
                {(['return', 'charity', 'recycle'] as const).map((value) => (
                  <option value={value} key={value}>
                    {actions[value]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor={`period-reason-${itemId}`}>{d.reason}</label>
            <input
              id={`period-reason-${itemId}`}
              name="reason"
              maxLength={500}
              required
              disabled={blocked}
            />
          </div>
          <label className="intake-confirm">
            <input type="checkbox" required disabled={blocked} />
            {d.confirm}
          </label>
          {action.error && <p role="alert">{action.error}</p>}
          {!action.needsReload && (
            <Button type="submit" disabled={action.busy}>
              {action.busy
                ? intake.busy
                : action.locked
                  ? intake.retry
                  : d.save}
            </Button>
          )}
          {action.needsReload && (
            <Button type="button" onClick={() => window.location.reload()}>
              {intake.reload}
            </Button>
          )}
          {saved && <p role="status">{d.saved}</p>}
        </form>
      </details>
    </section>
  )
}
