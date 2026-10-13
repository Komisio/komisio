'use client'
import { useBusyState } from '@/components/platform/work-activity'
import {
  NavigationLink as Link,
  useUnsavedChanges,
} from '@/components/platform/navigation-warning'
import { useRef, useState, useSyncExternalStore } from 'react'
import { FileUp, Info } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  guessMapping,
  mapRows,
  parseCsv,
  type ColumnMapping,
  type ImportSellersPayload,
} from '@/lib/engine/import-sellers'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

/** Choose a file, map the columns, read the preview, import the reviewed rows with one explicit confirmation. */
export function ImportSellers({
  tenantId,
  d,
  intake,
  leaveUnsaved,
}: {
  tenantId: string
  d: Dictionary['importer']
  intake: Dictionary['intake']
  leaveUnsaved: string
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [rows, setRows] = useState<string[][]>([])
  const [showInfo, setShowInfo] = useState(false)
  const [source, setSource] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping>({
    name: null,
    email: null,
    phone: null,
  })
  const [skipHeader, setSkipHeader] = useState(true)
  const [busy, setBusy] = useBusyState(false)
  const [message, setMessage] = useState('')
  const [completed, setCompleted] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [locked, setLocked] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const pending = useRef<{
    proposal: {
      tenantId: string
      requestId: string
      expiresAt: string
      payload: ImportSellersPayload
    }
    decisionId: string
    proposed: boolean
  } | null>(null)
  const running = useRef(false)
  const fileRead = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileButton = useRef<HTMLButtonElement>(null)
  useUnsavedChanges(
    (rows.length > 0 && !completed) || locked ? leaveUnsaved : null,
  )
  const header = rows[0] ?? []
  const { accepted, rejected } = rows.length
    ? mapRows(rows, mapping, skipHeader)
    : { accepted: [], rejected: [] }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (locked || running.current) return
    const read = ++fileRead.current
    setRows([])
    setCompleted(false)
    setMessage('')
    pending.current = null
    setNeedsReload(false)
    setSource(file?.name.slice(0, 200) ?? '')
    if (!file) return
    // Reject obviously oversized files before allocating their decoded contents.
    // This leaves ample room for multi-byte UTF-8 under the character limit below.
    if (file.size > 8_000_000) {
      setMessage(d.fileTooLarge)
      return
    }
    try {
      const text = await file.text()
      if (read !== fileRead.current) return
      if (text.length > 2_000_000) {
        setMessage(d.fileTooLarge)
        return
      }
      const parsed = parseCsv(text)
      setRows(parsed)
      const guessed = guessMapping(parsed[0] ?? [])
      setMapping(guessed)
      setMappingOpen(
        guessed.name === null ||
          (guessed.email === null && guessed.phone === null),
      )
      if (!parsed.length) setMessage(d.nothing)
    } catch {
      if (read === fileRead.current) setMessage(d.error)
    }
  }
  function clearFile() {
    if (locked || running.current) return
    fileRead.current++
    if (fileInput.current) fileInput.current.value = ''
    setRows([])
    setSource('')
    setMessage('')
    setMapping(guessMapping([]))
    setSkipHeader(true)
    fileButton.current?.focus()
  }
  async function importReviewed() {
    if (running.current || needsReload || completed || !accepted.length) return
    if (accepted.length > 200) {
      setMessage(d.tooMany)
      return
    }
    setBusy(true)
    running.current = true
    setLocked(true)
    setMessage('')
    pending.current ??= {
      proposal: {
        tenantId,
        requestId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        payload: { source, rows: accepted },
      },
      decisionId: crypto.randomUUID(),
      proposed: false,
    }
    try {
      const attempt = pending.current
      if (!attempt.proposed) {
        const r = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt.proposal),
        })
        const body = await r.json()
        if (!r.ok) {
          if (r.status >= 500) {
            setMessage(intake.failed)
            return
          }
          if (r.status === 400 && body.error === 'INVALID_INPUT') {
            pending.current = null
            setLocked(false)
          } else setNeedsReload(true)
          setMessage(d.error)
          return
        }
        if (
          body?.ok !== true ||
          body?.operationId !== attempt.proposal.requestId
        ) {
          setMessage(intake.failed)
          return
        }
        attempt.proposed = true
      }
      // The Import click approves exactly the previewed snapshot. Retain both
      // request identities across uncertain responses; never import a second copy.
      const decision = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: attempt.decisionId,
          operationId: attempt.proposal.requestId,
          decision: 'approve',
          reason: '',
        }),
      })
      const result = await decision.json()
      if (!decision.ok) {
        if (decision.status >= 500) setMessage(intake.failed)
        else {
          setNeedsReload(true)
          setMessage(d.error)
        }
        return
      }
      if (
        result?.id !== attempt.decisionId ||
        !['executed', 'failed', 'rejected'].includes(result?.outcome)
      ) {
        setMessage(intake.failed)
        return
      }
      if (result.outcome !== 'executed') {
        setMessage(d.error)
        setNeedsReload(true)
        return
      }
      setCompleted(true)
      pending.current = null
      setLocked(false)
    } catch {
      setMessage(intake.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const select = (key: keyof ColumnMapping) => (
    <div className="field" key={key}>
      <label htmlFor={`import-${key}`}>{d.column[key]}</label>
      <select
        id={`import-${key}`}
        disabled={busy || locked || completed}
        value={mapping[key] ?? ''}
        onChange={(e) =>
          setMapping({
            ...mapping,
            [key]: e.target.value === '' ? null : Number(e.target.value),
          })
        }
      >
        <option value="">{d.ignore}</option>
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h.trim() || `#${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  )
  return (
    <div className="import-workspace">
      <section className="card import-upload" aria-label={d.file}>
        <div className="import-section-heading">
          <h2>{d.file}</h2>
          <button
            type="button"
            className="import-info-button"
            aria-label={d.infoLabel}
            aria-expanded={showInfo}
            aria-controls="import-file-info"
            onClick={() => setShowInfo(!showInfo)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setShowInfo(false)
            }}
          >
            <Info size={20} aria-hidden="true" />
          </button>
        </div>
        <div
          id="import-file-info"
          hidden={!showInfo}
          className="import-file-info"
        >
          <p>{d.layoutHelp}</p>
          <p>{d.reviewHelp}</p>
          <p>{d.notice}</p>
        </div>
        <p id="import-file-hint" className="muted">
          {d.fileHint}
        </p>
        <div className="import-file-picker">
          <FileUp size={28} aria-hidden="true" className="import-file-icon" />
          <input
            ref={fileInput}
            id="import-file"
            type="file"
            hidden
            aria-label={d.file}
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            disabled={!ready || busy || locked}
          />
          <button
            ref={fileButton}
            id="import-file-button"
            type="button"
            className={source ? 'btn btn-secondary' : 'btn btn-primary'}
            disabled={!ready || busy || locked}
            aria-describedby="import-file-hint import-file-name"
            onClick={() => fileInput.current?.click()}
          >
            {source ? d.changeFile : d.chooseFile}
          </button>
          <span
            id="import-file-name"
            className="import-file-name"
            aria-live="polite"
          >
            {source || d.noFile}
          </span>
          {source && !completed && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || locked}
              onClick={clearFile}
            >
              {d.clearFile}
            </Button>
          )}
        </div>
      </section>
      {rows.length > 0 && (
        <section className="card intake-form" aria-label={d.preview}>
          <h2>{d.preview}</h2>
          <details
            className="import-mapping"
            open={mappingOpen}
            onToggle={(event) => setMappingOpen(event.currentTarget.open)}
          >
            <summary>{d.columns}</summary>
            <div className="import-column-mapping">
              {(['name', 'email', 'phone'] as const).map(select)}
            </div>
            <label className="import-header-checkbox">
              <input
                type="checkbox"
                disabled={busy || locked || completed}
                checked={skipHeader}
                onChange={(e) => setSkipHeader(e.target.checked)}
              />{' '}
              {d.skipHeader}
            </label>
          </details>
          <p>
            {accepted.length} {d.accepted}
            {rejected.length ? ` · ${rejected.length} ${d.rejected}` : ''}
          </p>
          {accepted.length === 0 && <p role="alert">{d.nothing}</p>}
          {accepted.length > 200 && <p role="alert">{d.tooMany}</p>}
          {accepted.length > 0 && (
            <div
              className="import-preview"
              tabIndex={0}
              role="group"
              aria-label={d.preview}
            >
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th scope="col">{d.column.name}</th>
                    <th scope="col">{d.column.email}</th>
                    <th scope="col">{d.column.phone}</th>
                  </tr>
                </thead>
                <tbody>
                  {accepted.slice(0, 200).map((r, i) => (
                    <tr key={i}>
                      <td data-label={d.column.name}>{r.name}</td>
                      <td data-label={d.column.email}>{r.email || '—'}</td>
                      <td data-label={d.column.phone}>{r.phone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rejected.length > 0 && (
            <ul>
              {rejected.slice(0, 10).map((r) => (
                <li key={r.line}>
                  {d.line} {r.line}: {d.reasons[r.reason]}
                </li>
              ))}
            </ul>
          )}
          {completed ? (
            <p role="status">
              {d.completed}{' '}
              <Link className="text-link" href="/intake/sellers">
                {d.viewSellers}
              </Link>
            </p>
          ) : (
            <Button
              disabled={
                busy ||
                needsReload ||
                accepted.length === 0 ||
                accepted.length > 200
              }
              onClick={importReviewed}
            >
              {busy ? intake.busy : locked ? intake.retry : d.import}
            </Button>
          )}
        </section>
      )}
      {message && <p role="alert">{message}</p>}
      {needsReload && (
        <a className="text-link" href="/intake/import">
          {intake.reload}
        </a>
      )}
    </div>
  )
}
