'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

type D = Dictionary['lifecycle']

/** The three lifecycle operations for one item; each submit is one replay-safe command. */
export function LifecycleActions({
  tenantId,
  itemId,
  dueStep,
  endOfPeriodAction,
  d,
  intake,
}: {
  tenantId: string
  itemId: string
  dueStep: number | null
  endOfPeriodAction: 'charity' | 'return' | null
  d: D
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState<string | null>(null)
  const submitted = useRef<{
    command: Record<string, unknown>
    label: string
  } | null>(null)
  const running = useRef(false)
  const blocked = action.busy || action.locked || action.needsReload
  async function run(command: Record<string, unknown>, label: string) {
    if (running.current || action.needsReload) return
    // The hook replays its pending command. Keep the matching outcome label,
    // too: another operation must never describe that replay as its own save.
    const attempt =
      action.locked && submitted.current
        ? submitted.current
        : { command: { ...command, tenantId, requestId, itemId }, label }
    submitted.current = attempt
    running.current = true
    setDone(null)
    try {
      if (await action.run(attempt.command)) {
        setDone(attempt.label)
        submitted.current = null
        setRequestId(crypto.randomUUID())
        router.refresh()
      }
    } finally {
      running.current = false
    }
  }
  return (
    <div className="lifecycle-actions">
      {dueStep !== null && (
        <Button
          type="button"
          disabled={blocked}
          onClick={() =>
            void run({ action: 'applyMarkdown', step: dueStep }, d.markdownDone)
          }
        >
          {d.applyMarkdown.replace('{step}', String(dueStep))}
        </Button>
      )}
      <form
        className="intake-fields"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          void run(
            {
              action: 'setItemPrice',
              priceOre: Math.round(Number(f.get('price')) * 100),
              reason: String(f.get('priceReason') ?? ''),
            },
            d.priceSet,
          )
        }}
      >
        <div className="field">
          <label htmlFor={`price-${itemId}`}>{d.price}</label>
          <input
            id={`price-${itemId}`}
            name="price"
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            required
            disabled={blocked}
          />
        </div>
        <div className="field">
          <label htmlFor={`price-reason-${itemId}`}>{d.priceReason}</label>
          <input
            id={`price-reason-${itemId}`}
            name="priceReason"
            required
            maxLength={500}
            disabled={blocked}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={blocked}>
          {d.setPrice}
        </Button>
      </form>
      <form
        className="intake-fields"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          void run(
            {
              action: 'extendSalePeriod',
              days: Number(f.get('days')),
              reason: String(f.get('reason') ?? ''),
            },
            d.extended,
          )
        }}
      >
        <div className="field">
          <label htmlFor={`days-${itemId}`}>{d.days}</label>
          <input
            id={`days-${itemId}`}
            name="days"
            type="number"
            min={1}
            max={365}
            defaultValue={14}
            required
            disabled={blocked}
          />
        </div>
        <div className="field">
          <label htmlFor={`extend-reason-${itemId}`}>{d.reason}</label>
          <input
            id={`extend-reason-${itemId}`}
            name="reason"
            required
            maxLength={500}
            disabled={blocked}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={blocked}>
          {d.extend}
        </Button>
      </form>
      <form
        className="intake-fields"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          void run(
            {
              action: 'endSalePeriod',
              endAction: String(f.get('endAction')),
              note: String(f.get('note') ?? ''),
            },
            d.ended,
          )
        }}
      >
        <div className="field">
          <label htmlFor={`end-action-${itemId}`}>{d.endAction}</label>
          <select
            id={`end-action-${itemId}`}
            name="endAction"
            defaultValue={endOfPeriodAction ?? 'charity'}
            disabled={blocked}
          >
            <option value="charity">{d.charity}</option>
            <option value="return">{d.return}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`end-note-${itemId}`}>{d.note}</label>
          <input
            id={`end-note-${itemId}`}
            name="note"
            maxLength={500}
            disabled={blocked}
          />
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required disabled={blocked} />
          {d.endConfirm}
        </label>
        <Button type="submit" variant="secondary" disabled={blocked}>
          {d.end}
        </Button>
      </form>
      {action.error && <p role="alert">{action.error}</p>}
      {action.locked && !action.needsReload && (
        <Button
          type="button"
          disabled={action.busy}
          onClick={() => {
            if (submitted.current)
              void run(submitted.current.command, submitted.current.label)
          }}
        >
          {action.busy ? intake.busy : intake.retry}
        </Button>
      )}
      {action.needsReload && (
        <Button type="button" onClick={() => window.location.reload()}>
          {intake.reload}
        </Button>
      )}
      {done && <p role="status">{done}</p>}
    </div>
  )
}
