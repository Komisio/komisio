'use client'
import Link from 'next/link'
import { useRef, useState, useSyncExternalStore } from 'react'
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

/** Choose a file, map the columns, read the preview, stage one operation. */
export function ImportSellers({
  tenantId,
  d,
  intake,
}: {
  tenantId: string
  d: Dictionary['importer']
  intake: Dictionary['intake']
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [rows, setRows] = useState<string[][]>([])
  const [source, setSource] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping>({
    name: null,
    email: null,
    phone: null,
  })
  const [skipHeader, setSkipHeader] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [staged, setStaged] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const pending = useRef<{
    tenantId: string
    requestId: string
    expiresAt: string
    payload: ImportSellersPayload
  } | null>(null)
  const running = useRef(false)
  const fileRead = useRef(0)
  const header = rows[0] ?? []
  const { accepted, rejected } = rows.length
    ? mapRows(rows, mapping, skipHeader)
    : { accepted: [], rejected: [] }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (locked || running.current) return
    const read = ++fileRead.current
    setRows([])
    setStaged(null)
    setMessage('')
    pending.current = null
    setNeedsReload(false)
    setSource('')
    if (!file) return
    try {
      const text = await file.text()
      if (read !== fileRead.current) return
      if (text.length > 2_000_000) {
        setMessage(d.fileTooLarge)
        return
      }
      const parsed = parseCsv(text)
      setRows(parsed)
      setSource(file.name.slice(0, 200))
      setMapping(guessMapping(parsed[0] ?? []))
      if (!parsed.length) setMessage(d.nothing)
    } catch {
      if (read === fileRead.current) setMessage(d.error)
    }
  }
  async function stage() {
    if (running.current || needsReload || staged || !accepted.length) return
    if (accepted.length > 200) {
      setMessage(d.tooMany)
      return
    }
    setBusy(true)
    running.current = true
    setLocked(true)
    setMessage('')
    pending.current ??= {
      tenantId,
      requestId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      payload: { source, rows: accepted },
    }
    try {
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
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
        body?.operationId !== pending.current.requestId
      ) {
        setMessage(intake.failed)
        return
      }
      setStaged(body.operationId)
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
        disabled={busy || locked || !!staged}
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
      <section className="card intake-form" aria-label={d.file}>
        <div className="field">
          <label htmlFor="import-file">{d.file}</label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            disabled={!ready || busy || locked}
          />
          <small>{d.fileHint}</small>
        </div>
        {rows.length > 0 && (
          <>
            <h3>{d.columns}</h3>
            {(['name', 'email', 'phone'] as const).map(select)}
            <label className="row">
              <input
                type="checkbox"
                disabled={busy || locked || !!staged}
                checked={skipHeader}
                onChange={(e) => setSkipHeader(e.target.checked)}
              />{' '}
              {d.skipHeader}
            </label>
          </>
        )}
      </section>
      {rows.length > 0 && (
        <section className="card intake-form" aria-label={d.preview}>
          <h2>{d.preview}</h2>
          <p>
            {accepted.length} {d.accepted}
            {rejected.length ? ` · ${rejected.length} ${d.rejected}` : ''}
          </p>
          {accepted.length === 0 && <p role="alert">{d.nothing}</p>}
          {accepted.length > 200 && <p role="alert">{d.tooMany}</p>}
          {accepted.length > 0 && (
            <div className="import-preview">
              <p>
                <small>{d.previewHint}</small>
              </p>
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th scope="col">{d.column.name}</th>
                    <th scope="col">{d.column.email}</th>
                    <th scope="col">{d.column.phone}</th>
                  </tr>
                </thead>
                <tbody>
                  {accepted.slice(0, 10).map((r, i) => (
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
          {staged ? (
            <p role="status">
              {d.staged}{' '}
              <Link className="text-link" href={`/intake/operations/${staged}`}>
                {d.openQueue}
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
              onClick={stage}
            >
              {busy ? intake.busy : locked ? intake.retry : d.stage}
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
