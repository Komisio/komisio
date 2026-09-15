'use client'
import Link from 'next/link'
import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  guessMapping,
  mapRows,
  parseCsv,
  type ColumnMapping,
} from '@/lib/engine/import-sellers'

/** Choose a file, map the columns, read the preview, stage one operation. */
export function ImportSellers({
  tenantId,
  d,
}: {
  tenantId: string
  d: Dictionary['importer']
}) {
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
  const requestId = useRef<string | null>(null)
  const header = rows[0] ?? []
  const { accepted, rejected } = rows.length
    ? mapRows(rows, mapping, skipHeader)
    : { accepted: [], rejected: [] }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const parsed = parseCsv(text.slice(0, 2_000_000))
    setRows(parsed)
    setSource(file.name.slice(0, 200))
    setMapping(guessMapping(parsed[0] ?? []))
    setStaged(null)
    setMessage('')
    requestId.current = null
  }
  async function stage() {
    if (busy || !accepted.length) return
    if (accepted.length > 200) {
      setMessage(d.tooMany)
      return
    }
    setBusy(true)
    setMessage('')
    requestId.current ??= crypto.randomUUID()
    try {
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: requestId.current,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          payload: { source, rows: accepted },
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(d.error)
        return
      }
      setStaged(body.operationId)
    } catch {
      setMessage(d.error)
    } finally {
      setBusy(false)
    }
  }
  const select = (key: keyof ColumnMapping) => (
    <div className="field" key={key}>
      <label htmlFor={`import-${key}`}>{d.column[key]}</label>
      <select
        id={`import-${key}`}
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
    <div className="intake-grid">
      <section className="card intake-form" aria-label={d.file}>
        <div className="field">
          <label htmlFor="import-file">{d.file}</label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
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
          {accepted.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <p>
                <small>{d.previewHint}</small>
              </p>
              <table>
                <thead>
                  <tr>
                    <th>{d.column.name}</th>
                    <th>{d.column.email}</th>
                    <th>{d.column.phone}</th>
                  </tr>
                </thead>
                <tbody>
                  {accepted.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.email}</td>
                      <td>{r.phone}</td>
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
            <Button disabled={busy || accepted.length === 0} onClick={stage}>
              {d.stage}
            </Button>
          )}
          {message && <p role="alert">{message}</p>}
        </section>
      )}
    </div>
  )
}
