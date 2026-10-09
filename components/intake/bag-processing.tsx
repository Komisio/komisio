'use client'
import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary, Locale } from '@/lib/i18n'
import type { BagProcessingState } from '@/lib/engine/bag-processing'
import { useIntakeAction } from './use-intake-action'
import { EventTime } from '@/components/ui/event-time'
import {
  useConfirmNavigation,
  useUnsavedChanges,
} from '@/components/platform/navigation-warning'

const subscribe = () => () => {}
export function BagProcessing({
  tenantId,
  bagId,
  current,
  pending,
  readonly,
  d,
  locale,
}: {
  tenantId: string
  bagId: string
  current: BagProcessingState
  pending: boolean
  readonly: boolean
  d: Dictionary
  locale: Locale
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const action = useIntakeAction(d.intake),
    router = useRouter()
  const confirm = useConfirmNavigation()
  const [reason, setReason] = useState(''),
    [reopening, setReopening] = useState(false)
  const [saved, setSaved] = useState(false)
  const s = d.bagProcessing,
    completed = current.state === 'completed'
  useUnsavedChanges(
    !saved && (reason.length > 0 || action.locked)
      ? d.inspection.leaveDraft
      : null,
  )
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saved || (!completed && !action.locked && !confirm())) return
    const id = await action.run({
      action: 'setBagProcessing',
      tenantId,
      bagId,
      requestId: crypto.randomUUID(),
      expectedVersion: current.version,
      state: completed ? 'open' : 'completed',
      reason,
    })
    if (id) {
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <section className="card intake-form" aria-label={s.title}>
      <div className="row wrap">
        <h2>{s.title}</h2>
        <strong data-bag-processing-state aria-live="polite">
          {s[saved ? (completed ? 'open' : 'completed') : current.state]}
        </strong>
      </div>
      {!readonly && !saved && (
        <form onSubmit={submit}>
          {completed && !reopening ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!ready}
              onClick={() => setReopening(true)}
            >
              {s.reopen}
            </button>
          ) : (
            <>
              {completed && (
                <div className="field">
                  <label htmlFor="bag-reopen-reason">{s.reason}</label>
                  <input
                    id="bag-reopen-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    maxLength={500}
                    disabled={action.busy || action.locked}
                  />
                </div>
              )}
              {!completed && pending && <p>{s.pending}</p>}
              <button
                className="btn btn-secondary"
                disabled={
                  !ready ||
                  action.busy ||
                  action.needsReload ||
                  (!completed && pending)
                }
              >
                {action.busy
                  ? d.intake.busy
                  : completed
                    ? s.reopen
                    : s.complete}
              </button>
              {completed && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={action.busy || action.locked}
                  onClick={() => {
                    setReopening(false)
                    setReason('')
                  }}
                >
                  {d.cancel}
                </button>
              )}
            </>
          )}
          {action.error && (
            <p className="form-error" role="alert">
              {action.error}
            </p>
          )}
          {action.needsReload && (
            <a href={`/intake/bags/${bagId}/inspect`} className="text-link">
              {d.inspection.reload}
            </a>
          )}
        </form>
      )}
      {current.history.length > 0 && (
        <details>
          <summary>{s.history}</summary>
          <ul>
            {current.history.map((h) => (
              <li key={h.version}>
                <strong>{s[h.state]}</strong> ·{' '}
                <EventTime value={h.at} locale={locale} />
                {h.actor && <> · {h.actor}</>}
                {h.reason && <p>{h.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
