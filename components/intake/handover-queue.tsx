'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { EventTime } from '@/components/ui/event-time'
import type { HandoverQueueRow } from '@/lib/engine/handovers'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Open handovers with independently retained, replay-safe receipt forms. */
export function HandoverQueue({
  tenantId,
  rows,
  write,
  focus,
  locale,
  d,
  intake,
}: {
  tenantId: string
  rows: HandoverQueueRow[]
  write: boolean
  focus: string | null
  locale: string
  d: Dictionary['handovers']
  intake: Dictionary['intake']
}) {
  const [stale, setStale] = useState(false)
  const focusVisible = rows.some((row) => row.id === focus)
  useEffect(() => {
    if (!focus || !focusVisible) return
    const receipt = document.getElementById('handover-' + focus)
    receipt?.focus({ preventScroll: true })
    receipt?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [focus, focusVisible])
  return (
    <>
      {rows.length === 0 && <p>{d.empty}</p>}
      {rows.map((h) => (
        <div
          key={h.id}
          id={'handover-' + h.id}
          tabIndex={-1}
          className="intake-notice handover-card"
          style={{
            scrollMarginTop: '1rem',
            ...(focus === h.id ? { outline: '2px solid currentColor' } : {}),
          }}
        >
          <strong className="handover-card-heading">
            <Link className="text-link" href={`/intake/sellers/${h.sellerId}`}>
              {h.sellerName}
            </Link>
            <span className={`handover-status handover-status-${h.status}`}>
              {d.statuses[h.status]}
            </span>
          </strong>
          <p className="handover-card-reference">
            {h.reference} · {d.kinds[h.kind]} ·{' '}
            {(h.estimatedItems === 1
              ? d.estimatedCountOne
              : d.estimatedCount
            ).replace('{count}', String(h.estimatedItems))}
          </p>
          {h.note && <p className="handover-card-note">{h.note}</p>}
          <p className="handover-card-meta">
            <span>
              {d.announced} <EventTime value={h.createdAt} locale={locale} />
            </span>
            {h.bagId && (
              <Link className="text-link" href={`/intake/bags/${h.bagId}`}>
                {d.openBag}
              </Link>
            )}
          </p>
          {write && h.status === 'open' && (
            <HandoverReceipt
              tenantId={tenantId}
              handoverId={h.id}
              d={d}
              intake={intake}
              blocked={stale}
              onStale={setStale}
            />
          )}
        </div>
      ))}
    </>
  )
}

/** A different row's refresh must not replace this form or its pending command. */
function HandoverReceipt({
  tenantId,
  handoverId,
  d,
  intake,
  blocked,
  onStale,
}: {
  tenantId: string
  handoverId: string
  d: Dictionary['handovers']
  intake: Dictionary['intake']
  blocked: boolean
  onStale: (stale: true) => void
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (action.needsReload) onStale(true)
  }, [action.needsReload, onStale])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (done || blocked) return
    const command = action.locked
      ? {}
      : {
          action: 'receiveHandover',
          tenantId,
          requestId,
          handoverId,
          source: 'staff_receipt',
          note: String(new FormData(event.currentTarget).get('note') ?? ''),
        }
    if (await action.run(command)) {
      setDone(true)
      router.refresh()
    }
  }
  if (done) return <p role="status">{d.statuses.received}</p>
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={blocked || action.busy || action.locked || action.needsReload}
      >
        <details className="handover-note">
          <summary>{d.note}</summary>
          <div className="field">
            <label htmlFor={`note-${handoverId}`} className="sr-only">
              {d.note}
            </label>
            <input id={`note-${handoverId}`} name="note" maxLength={500} />
          </div>
        </details>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.confirm}
        </label>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && (
        <Button type="button" onClick={() => window.location.reload()}>
          {intake.reload}
        </Button>
      )}
      <Button
        type="submit"
        disabled={blocked || action.busy || action.needsReload}
      >
        {action.busy
          ? intake.busy
          : action.locked && !action.needsReload
            ? intake.retry
            : d.receive}
      </Button>
    </form>
  )
}
