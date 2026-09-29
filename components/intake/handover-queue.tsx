'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import type { HandoverQueueRow } from '@/lib/engine/handovers'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Open handovers with a receive action; each receipt is one replay-safe command. */
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
  const action = useIntakeAction(intake)
  const router = useRouter()
  useEffect(() => {
    if (!focus) return
    const receipt = document.getElementById('handover-' + focus)
    receipt?.focus({ preventScroll: true })
    receipt?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [focus])
  const [requestIds] = useState(() => new Map<string, string>())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const running = useRef(false)
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), {
      timeZone: 'Europe/Stockholm',
    })
  async function receive(id: string, note: string) {
    if (
      running.current ||
      action.needsReload ||
      (action.locked && pendingId !== id)
    )
      return
    if (!requestIds.has(id)) requestIds.set(id, crypto.randomUUID())
    setPendingId(id)
    running.current = true
    try {
      if (
        await action.run({
          action: 'receiveHandover',
          tenantId,
          requestId: requestIds.get(id),
          handoverId: id,
          source: 'staff_receipt',
          note,
        })
      ) {
        setPendingId(null)
        router.refresh()
      }
    } finally {
      running.current = false
    }
  }
  return (
    <>
      {rows.length === 0 && <p>{d.empty}</p>}
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && (
        <Button type="button" onClick={() => window.location.reload()}>
          {intake.reload}
        </Button>
      )}
      {rows.map((h) => (
        <div
          key={h.id}
          id={'handover-' + h.id}
          tabIndex={-1}
          className="intake-notice"
          style={{
            scrollMarginTop: '1rem',
            ...(focus === h.id ? { outline: '2px solid currentColor' } : {}),
          }}
        >
          <strong>
            {h.reference} ·{' '}
            <Link className="text-link" href={`/intake/sellers/${h.sellerId}`}>
              {h.sellerName}
            </Link>{' '}
            · {d.kinds[h.kind]} · {h.estimatedItems} {d.items} ·{' '}
            {d.statuses[h.status]}
          </strong>
          <p>
            {d.announced} {when(h.createdAt)}
            {h.note ? ` · ${h.note}` : ''}
            {h.bagId ? (
              <>
                {' · '}
                <Link className="text-link" href={`/intake/bags/${h.bagId}`}>
                  {d.openBag}
                </Link>
              </>
            ) : null}
          </p>
          {write && h.status === 'open' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void receive(
                  h.id,
                  String(new FormData(e.currentTarget).get('note') ?? ''),
                )
              }}
            >
              <fieldset
                className="intake-fields"
                disabled={action.busy || action.locked || action.needsReload}
              >
                <details className="handover-note">
                  <summary>{d.note}</summary>
                  <div className="field">
                    <label htmlFor={`note-${h.id}`} className="sr-only">
                      {d.note}
                    </label>
                    <input id={`note-${h.id}`} name="note" maxLength={500} />
                  </div>
                </details>
                <label className="intake-confirm">
                  <input type="checkbox" required />
                  {d.confirm}
                </label>
              </fieldset>
              <Button
                type="submit"
                disabled={
                  action.busy ||
                  action.needsReload ||
                  (action.locked && pendingId !== h.id)
                }
              >
                {action.busy && pendingId === h.id
                  ? intake.busy
                  : action.locked && pendingId === h.id && !action.needsReload
                    ? intake.retry
                    : d.receive}
              </Button>
            </form>
          )}
        </div>
      ))}
    </>
  )
}
