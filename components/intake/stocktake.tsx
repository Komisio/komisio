'use client'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { StocktakeReport } from '@/lib/engine/stocktake'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useIntakeAction } from './use-intake-action'

const Workspace = createContext<{
  busy: boolean
  begin: () => boolean
  end: (refresh: boolean) => void
} | null>(null)

/** Keep other commands disabled until the confirmed server revision is rendered. */
export function StocktakeWorkspace({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter(),
    running = useRef(false)
  const [working, setWorking] = useState(false),
    [pending, transition] = useTransition()
  return (
    <Workspace.Provider
      value={{
        busy: working || pending,
        begin: () => {
          if (running.current || pending) return false
          running.current = true
          setWorking(true)
          return true
        },
        end: (refresh) => {
          if (refresh) transition(() => router.refresh())
          running.current = false
          setWorking(false)
        },
      }}
    >
      {children}
    </Workspace.Provider>
  )
}
function useStocktakeAction(d: Dictionary) {
  const action = useIntakeAction(d.intake),
    workspace = useContext(Workspace)
  if (!workspace) throw new Error('Stocktake workspace is required')
  return {
    ...action,
    busy: action.busy || workspace.busy,
    run: async (input: unknown) => {
      if (!workspace.begin()) return null
      let id: string | null = null
      try {
        id = await action.run(input)
        return id
      } finally {
        workspace.end(!!id)
      }
    },
  }
}

function Feedback({
  action,
  d,
}: {
  action: ReturnType<typeof useIntakeAction>
  d: Dictionary
}) {
  return (
    <>
      {action.error && (
        <p className="form-error" role="alert">
          {action.error}
        </p>
      )}
      {action.needsReload && (
        <a className="text-link" href="/intake/stocktake">
          {d.inspection.reload}
        </a>
      )}
    </>
  )
}
export function StocktakeStart({
  tenantId,
  d,
}: {
  tenantId: string
  d: Dictionary
}) {
  const action = useIntakeAction(d.intake),
    router = useRouter()
  const [saved, setSaved] = useState(false)
  useUnsavedChanges(!saved && action.locked ? d.inspection.leaveDraft : null)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const id = await action.run({
          action: 'startStocktake',
          tenantId,
          requestId: crypto.randomUUID(),
        })
        if (id) {
          setSaved(true)
          router.push(`/intake/stocktake?session=${id}`)
          router.refresh()
        }
      }}
    >
      <button
        className="btn btn-primary"
        disabled={saved || action.busy || action.needsReload}
      >
        {action.busy ? d.intake.busy : d.stocktake.start}
      </button>
      <Feedback action={action} d={d} />
    </form>
  )
}
export function StocktakeScan({
  tenantId,
  sessionId,
  d,
}: {
  tenantId: string
  sessionId: string
  d: Dictionary
}) {
  const action = useStocktakeAction(d),
    input = useRef<HTMLInputElement>(null),
    focusAfterScan = useRef(false)
  const [reference, setReference] = useState(''),
    [last, setLast] = useState('')
  useEffect(() => {
    if (focusAfterScan.current && !action.busy) {
      focusAfterScan.current = false
      input.current?.focus()
    }
  }, [last, action.busy])
  useUnsavedChanges(
    reference.length > 0 || action.locked ? d.inspection.leaveDraft : null,
  )
  return (
    <form
      className="card intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const id = await action.run({
          action: 'scanStocktake',
          tenantId,
          sessionId,
          reference,
          requestId: crypto.randomUUID(),
        })
        if (id) {
          focusAfterScan.current = true
          setLast(reference)
          setReference('')
        }
      }}
    >
      <div className="field">
        <label htmlFor="stocktake-scan">{d.stocktake.reference}</label>
        <div className="row wrap">
          <input
            id="stocktake-scan"
            ref={input}
            value={reference}
            maxLength={64}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setReference(e.target.value)}
            readOnly={action.busy || action.locked}
          />
          <button
            className="btn btn-primary"
            disabled={action.busy || action.needsReload}
          >
            {action.busy ? d.intake.busy : d.stocktake.scan}
          </button>
        </div>
      </div>
      {last && (
        <p role="status">
          {d.stocktake.scanned}: {last.toUpperCase()}
        </p>
      )}
      <Feedback action={action} d={d} />
    </form>
  )
}
export function StocktakeFinding({
  tenantId,
  sessionId,
  item,
  d,
}: {
  tenantId: string
  sessionId: string
  item: StocktakeReport['rows'][number]
  d: Dictionary
}) {
  const action = useStocktakeAction(d)
  const [observation, setObservation] = useState(
      item.observation === 'unchecked' ? 'missing' : item.observation,
    ),
    [reason, setReason] = useState(''),
    [saved, setSaved] = useState(false)
  useUnsavedChanges(
    !saved && (reason.length > 0 || action.locked)
      ? d.inspection.leaveDraft
      : null,
  )
  return (
    <details>
      <summary>{d.stocktake.finding}</summary>
      <form
        className="intake-form"
        onSubmit={async (e) => {
          e.preventDefault()
          const id = await action.run({
            action: 'recordStocktakeFinding',
            tenantId,
            sessionId,
            itemId: item.id,
            expectedVersion: item.version,
            observation,
            reason,
            requestId: crypto.randomUUID(),
          })
          if (id) {
            setSaved(true)
          }
        }}
      >
        <fieldset disabled={saved || action.busy || action.locked}>
          <legend className="sr-only">{d.stocktake.finding}</legend>
          <div className="field">
            <label htmlFor={`finding-${item.id}`}>{d.stocktake.finding}</label>
            <select
              id={`finding-${item.id}`}
              value={observation}
              onChange={(e) =>
                setObservation(e.target.value as typeof observation)
              }
            >
              {(['found', 'missing', 'damaged'] as const).map((s) => (
                <option key={s} value={s}>
                  {d.stocktake[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`reason-${item.id}`}>{d.stocktake.reason}</label>
            <input
              id={`reason-${item.id}`}
              value={reason}
              required
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </fieldset>
        <button
          className="btn btn-secondary"
          disabled={saved || action.busy || action.needsReload}
        >
          {action.busy ? d.intake.busy : d.stocktake.save}
        </button>
        <Feedback action={action} d={d} />
      </form>
    </details>
  )
}
export function StocktakeFinish({
  tenantId,
  report,
  d,
}: {
  tenantId: string
  report: StocktakeReport
  d: Dictionary
}) {
  const action = useStocktakeAction(d),
    [saved, setSaved] = useState(false)
  useUnsavedChanges(!saved && action.locked ? d.inspection.leaveDraft : null)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const id = await action.run({
          action: 'finishStocktake',
          tenantId,
          sessionId: report.id,
          expectedVersion: report.version,
          requestId: crypto.randomUUID(),
        })
        if (id) {
          setSaved(true)
        }
      }}
    >
      {report.counts.unchecked > 0 && <p>{d.intake.stocktakePending}</p>}
      <button
        className="btn btn-secondary"
        disabled={
          saved ||
          action.busy ||
          action.needsReload ||
          report.counts.unchecked > 0
        }
      >
        {action.busy ? d.intake.busy : d.stocktake.finish}
      </button>
      <Feedback action={action} d={d} />
    </form>
  )
}
