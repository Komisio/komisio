'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import {
  inventoryColumns,
  inventoryPreview,
  parseInventoryFile,
  type InventoryFile,
  type InventoryPreview,
} from '@/lib/engine/inventory-import'
import { formatMoney } from '@/lib/engine/money'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ImportInventoryPreview({
  tenantId,
  currency,
  d,
  intake,
  leaveUnsaved,
}: {
  tenantId: string
  currency: string
  d: Dictionary['inventoryImport']
  intake: Dictionary['intake']
  leaveUnsaved: string
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [file, setFile] = useState<InventoryFile | null>(null)
  const [result, setResult] = useState<InventoryPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [checkedAt, setCheckedAt] = useState('')
  const summary = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (result) summary.current?.focus()
  }, [result])
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0),
    running = useRef(false)
  useUnsavedChanges(file ? leaveUnsaved : null)
  function clear() {
    generation.current++
    setFile(null)
    setResult(null)
    setError('')
    setReading(false)
    if (input.current) input.current.value = ''
  }
  async function load(event: React.ChangeEvent<HTMLInputElement>) {
    if (running.current) return
    const selected = event.target.files?.[0]
    clear()
    if (!selected) return
    const current = generation.current
    setReading(true)
    try {
      if (selected.size > 1000000) throw new Error('FILE_TOO_LARGE')
      const text = await selected.text()
      if (current !== generation.current) return
      setFile(parseInventoryFile(text, selected.name))
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error && e.message === 'TOO_MANY_ROWS'
            ? d.tooMany
            : e instanceof Error && e.message === 'FILE_TOO_LARGE'
              ? d.tooLarge
              : d.invalidFile,
        )
    } finally {
      if (current === generation.current) setReading(false)
    }
  }
  async function check() {
    if (!file || running.current) return
    const current = generation.current
    running.current = true
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch('/api/import/items/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, file }),
      })
      if (!response.ok) throw new Error('REQUEST_FAILED')
      const report = inventoryPreview.parse(await response.json())
      if (
        report.rows.length !== file.rows.length ||
        report.rows.some((r, i) => r.line !== file.rows[i].line)
      )
        throw new Error('UNCONFIRMED_RESULT')
      if (current === generation.current) {
        setResult(report)
        setCheckedAt(new Date().toISOString())
      }
    } catch {
      if (current === generation.current) setError(d.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const problems = result?.rows.filter((row) => row.issues.length).length ?? 0
  return (
    <div className="import-workspace inventory-import-workspace">
      <section className="card intake-form" aria-label={d.file}>
        <div className="field">
          <label htmlFor="inventory-file">{d.file}</label>
          <input
            ref={input}
            id="inventory-file"
            hidden
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={load}
            disabled={!ready || busy}
          />
          <div className="row">
            <Button
              variant="secondary"
              type="button"
              disabled={!ready || busy}
              onClick={() => input.current?.click()}
            >
              {d.choose}
            </Button>
            <span>{file?.source}</span>
          </div>
          <small>{d.fileHint.replace('{currency}', currency)}</small>
        </div>
        <div className="row">
          <Button
            variant="secondary"
            type="button"
            disabled={!ready || busy}
            onClick={() =>
              download(
                '\uFEFF' +
                  inventoryColumns.join(';') +
                  '\r\nREF-001;;seller@example.test;' +
                  d.example +
                  ';200;' +
                  currency +
                  '\r\n',
                'komisio-items-template.csv',
                'text/csv;charset=utf-8',
              )
            }
          >
            {d.template}
          </Button>
          {file && (
            <Button variant="secondary" disabled={busy} onClick={clear}>
              {d.clear}
            </Button>
          )}
        </div>
        {reading && <p role="status">{intake.busy}</p>}
        {file && (
          <>
            <p>{d.rows.replace('{count}', String(file.rows.length))}</p>
            <Button disabled={busy} onClick={check}>
              {busy ? intake.busy : d.check}
            </Button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      {result && file && (
        <section className="card stock-panel" aria-label={d.result}>
          <h2 ref={summary} tabIndex={-1}>
            {d.result}
          </h2>
          <p role="status">
            {problems
              ? d.problems.replace('{count}', String(problems))
              : d.noProblems}
          </p>
          <p className="muted">{d.noWrites}</p>
          <div className="stock-table-wrap">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>{d.line}</th>
                  <th>{d.reference}</th>
                  <th>{d.description}</th>
                  <th>{d.seller}</th>
                  <th>{d.price}</th>
                  <th>{d.status}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={row.line}>
                    <th scope="row">
                      {d.line} {row.line}
                    </th>
                    <td data-label={d.reference}>
                      {file.rows[i].reference || '—'}
                    </td>
                    <td data-label={d.description}>
                      {file.rows[i].description || '—'}
                    </td>
                    <td data-label={d.seller}>
                      {row.seller?.status === 'matched'
                        ? row.seller.name
                        : file.rows[i].email || file.rows[i].sellerId || '—'}
                    </td>
                    <td data-label={d.price}>
                      {row.priceOre === null
                        ? '—'
                        : formatMoney(row.priceOre, file.rows[i].currency)}
                    </td>
                    <td data-label={d.status}>
                      {row.issues.length ? (
                        <ul>
                          {row.issues.map((issue) => (
                            <li key={issue}>{d.issues[issue]}</li>
                          ))}
                        </ul>
                      ) : (
                        d.checked
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              download(
                JSON.stringify(
                  {
                    version: 1,
                    source: file.source,
                    checkedAt,
                    currency: result.currency,
                    rows: file.rows.map((row, i) => ({
                      ...row,
                      ...result.rows[i],
                    })),
                  },
                  null,
                  2,
                ),
                'komisio-items-check.json',
                'application/json',
              )
            }
          >
            {d.download}
          </Button>
        </section>
      )}
    </div>
  )
}
