'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Dictionary } from '@/lib/i18n'
import Link from '@/components/platform/working-link'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import {
  inventoryColumns,
  inventoryPreview,
  inventoryImportCommand,
  inventoryImportResult,
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
  const [busy, setBusy] = useBusyState(false)
  const [reading, setReading] = useBusyState(false)
  const [checkedAt, setCheckedAt] = useState('')
  const [received, setReceived] = useState(false)
  const [locked, setLocked] = useState(false)
  const [completion, setCompletion] = useState<ReturnType<
    typeof inventoryImportResult.parse
  > | null>(null)
  const attempt = useRef<ReturnType<
    typeof inventoryImportCommand.parse
  > | null>(null)
  const summary = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (result) summary.current?.focus()
  }, [result])
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0),
    running = useRef(false)
  useUnsavedChanges(file && !completion ? leaveUnsaved : null)
  function clear() {
    generation.current++
    setFile(null)
    setResult(null)
    setError('')
    setReading(false)
    setReceived(false)
    setCompletion(null)
    setLocked(false)
    attempt.current = null
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
    if (!file || running.current || locked) return
    const current = generation.current
    running.current = true
    setBusy(true)
    setError('')
    setResult(null)
    setReceived(false)
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
  async function commit() {
    if (
      !file ||
      !result ||
      !received ||
      running.current ||
      completion ||
      result.rows.some((r) => r.issues.length)
    )
      return
    if (!attempt.current) {
      attempt.current = inventoryImportCommand.parse({
        tenantId,
        requestId: crypto.randomUUID(),
        source: file.source,
        context: result.context,
        received: true,
        rows: file.rows.map((row, i) => ({
          reference: row.reference,
          description: row.description,
          email: row.email,
          sellerId:
            result.rows[i].seller?.status === 'matched'
              ? result.rows[i].seller.id
              : null,
          priceOre: result.rows[i].priceOre,
          currency: result.currency,
        })),
      })
    }
    const command = attempt.current
    running.current = true
    setLocked(true)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/import/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status < 500 && typeof body.error === 'string') {
          attempt.current = null
          setLocked(false)
          const code = body.error as keyof typeof d.errors
          setError(d.errors[code] ?? d.failed)
          return
        }
        throw new Error('REQUEST_FAILED')
      }
      const done = inventoryImportResult.parse(body)
      if (
        done.requestId !== command.requestId ||
        done.created + done.skipped !== command.rows.length ||
        done.items.length !== command.rows.length ||
        done.items.some(
          (r, i) => r.sourceReference !== command.rows[i].reference,
        )
      )
        throw new Error('REQUEST_FAILED')
      setCompletion(done)
      setLocked(false)
    } catch {
      // Keep the exact snapshot and request ID until its outcome is confirmed.
      setError(d.retry)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const problems = result?.rows.filter((row) => row.issues.length).length ?? 0
  return (
    <div className="import-workspace inventory-import-workspace">
      {!completion && (
        <section className="card intake-form" aria-label={d.file}>
          <input
            ref={input}
            id="inventory-file"
            hidden
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={load}
            disabled={!ready || busy || locked}
          />
          {result && file ? (
            <div className="row">
              <span>
                <strong>{file.source}</strong>
                <br />
                <small>
                  {d.rows.replace('{count}', String(file.rows.length))}
                </small>
              </span>
              <Button
                variant="secondary"
                disabled={busy || locked}
                onClick={clear}
              >
                {d.clear}
              </Button>
              {error && (
                <Button
                  variant="secondary"
                  disabled={busy || locked}
                  onClick={check}
                >
                  {d.check}
                </Button>
              )}
            </div>
          ) : (
            <>
              <h2>{d.file}</h2>
              <p className="muted">
                {d.fileHint.replace('{currency}', currency)}
              </p>
              <div className="import-file-picker">
                <Button
                  type="button"
                  disabled={!ready || busy}
                  onClick={() => input.current?.click()}
                >
                  {d.choose}
                </Button>
                {file && (
                  <span className="import-file-name">{file.source}</span>
                )}
              </div>
              <div className="row">
                {file && (
                  <Button disabled={busy || reading} onClick={check}>
                    {busy ? intake.busy : d.check}
                  </Button>
                )}
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
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </section>
      )}
      {completion && (
        <section className="card intake-form" aria-label={d.complete}>
          <h2>{d.complete}</h2>
          <p role="status">
            {d.completed
              .replace('{created}', String(completion.created))
              .replace('{skipped}', String(completion.skipped))}
          </p>
          <div className="import-preview">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>{d.reference}</th>
                  <th>{d.description}</th>
                </tr>
              </thead>
              <tbody>
                {completion.items.map((item, i) => (
                  <tr key={item.sourceReference}>
                    <td data-label={d.reference}>{item.sourceReference}</td>
                    <td data-label={d.description}>
                      <Link href={`/intake/items/${item.itemId}`}>
                        {file?.rows[i].description} · {item.reference}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <Button onClick={clear}>{d.another}</Button>
            <Link href="/intake/items">{d.viewItems}</Link>
          </div>
        </section>
      )}
      {result && file && !completion && (
        <section
          className="card stock-panel inventory-import-preview"
          aria-label={d.result}
        >
          <h2 ref={summary} tabIndex={-1}>
            {d.result}
          </h2>
          <p role="status">
            {problems
              ? d.problems.replace('{count}', String(problems))
              : d.noProblems}
          </p>
          <p className="muted">{d.currentTerms}</p>
          <div className="stock-table-wrap import-preview">
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
          {!problems && (
            <>
              <label className="import-header-checkbox">
                <input
                  type="checkbox"
                  checked={received}
                  disabled={busy || locked}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                {d.received}
              </label>
              <div className="row">
                <Button disabled={!received || busy} onClick={commit}>
                  {busy ? intake.busy : d.import}
                </Button>
              </div>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {problems > 0 && (
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
          )}
        </section>
      )}
    </div>
  )
}
