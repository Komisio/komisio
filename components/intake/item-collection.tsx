'use client'
import { useRef, useState } from 'react'
import type { Dictionary, Locale } from '@/lib/i18n'
import type { itemCollectionState } from '@/lib/engine/item-collection'
import { economyFormat } from '@/lib/intake/economy-format'
import { useIntakeAction } from './use-intake-action'
import { useRouter } from '@/components/platform/use-working-router'
import { Button } from '@/components/ui/button'

export function ItemCollection({
  tenantId,
  itemId,
  state,
  write,
  today,
  locale,
  d,
  intake,
}: {
  tenantId: string
  itemId: string
  state: NonNullable<ReturnType<typeof itemCollectionState>>
  write: boolean
  today: string
  locale: Locale
  d: Dictionary['itemCollection']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState(false)
  const running = useRef(false)
  const blocked = action.busy || action.locked || action.needsReload
  async function submit(form: HTMLFormElement) {
    if (running.current || action.needsReload) return
    const data = new FormData(form)
    running.current = true
    setSaved(false)
    try {
      if (
        await action.run({
          action: 'recordItemCollection',
          tenantId,
          requestId,
          itemId,
          endEventId: state.endEventId,
          expectedCurrentId: state.current?.id ?? null,
          collected: data.get('collected') === 'true',
          observedOn: String(data.get('observedOn') ?? ''),
          note: String(data.get('note') ?? ''),
        })
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
      <p data-testid="collection-status">
        <strong>
          {state.current
            ? state.current.collected
              ? d.collected
              : d.notCollected
            : d.unrecorded}
        </strong>
        {state.current && (
          <>
            {' '}
            ·{' '}
            <time dateTime={state.current.observedOn}>
              {economyFormat(locale).date(state.current.observedOn)}
            </time>
          </>
        )}
      </p>
      {write && (
        <details>
          <summary>{d.record}</summary>
          <form
            className="intake-fields"
            onSubmit={(event) => {
              event.preventDefault()
              void submit(event.currentTarget)
            }}
          >
            <div className="field">
              <label htmlFor={`collection-state-${itemId}`}>{d.status}</label>
              <select
                id={`collection-state-${itemId}`}
                name="collected"
                defaultValue=""
                required
                disabled={blocked}
              >
                <option value="" disabled>
                  {d.choose}
                </option>
                <option value="true">{d.collected}</option>
                <option value="false">{d.notCollected}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`collection-date-${itemId}`}>{d.date}</label>
              <input
                id={`collection-date-${itemId}`}
                name="observedOn"
                type="date"
                min="1900-01-01"
                max={today}
                defaultValue={today}
                required
                disabled={blocked}
              />
            </div>
            <div className="field">
              <label htmlFor={`collection-note-${itemId}`}>{d.note}</label>
              <input
                id={`collection-note-${itemId}`}
                name="note"
                maxLength={500}
                disabled={blocked}
              />
            </div>
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
      )}
    </section>
  )
}
