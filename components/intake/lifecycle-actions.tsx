'use client'
import { useState } from 'react'
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
  async function run(command: Record<string, unknown>, label: string) {
    if (await action.run({ ...command, tenantId, requestId, itemId })) {
      setDone(label)
      setRequestId(crypto.randomUUID())
      router.refresh()
    }
  }
  return (
    <div className="lifecycle-actions">
      {dueStep !== null && (
        <Button
          type="button"
          disabled={action.busy}
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
          />
        </div>
        <div className="field">
          <label htmlFor={`price-reason-${itemId}`}>{d.priceReason}</label>
          <input
            id={`price-reason-${itemId}`}
            name="priceReason"
            required
            maxLength={500}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={action.busy}>
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
          />
        </div>
        <div className="field">
          <label htmlFor={`extend-reason-${itemId}`}>{d.reason}</label>
          <input
            id={`extend-reason-${itemId}`}
            name="reason"
            required
            maxLength={500}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={action.busy}>
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
          >
            <option value="charity">{d.charity}</option>
            <option value="return">{d.return}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`end-note-${itemId}`}>{d.note}</label>
          <input id={`end-note-${itemId}`} name="note" maxLength={500} />
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.endConfirm}
        </label>
        <Button type="submit" variant="secondary" disabled={action.busy}>
          {d.end}
        </Button>
      </form>
      {action.error && <p role="alert">{action.error}</p>}
      {done && <p role="status">{done}</p>}
    </div>
  )
}
