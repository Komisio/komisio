'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PrivacyRequestRow } from '@/lib/engine/shopify-privacy'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

export function ShopifyPrivacyQueue({
  rows,
  tenantId,
  locale,
  d,
}: {
  rows: PrivacyRequestRow[]
  tenantId: string | null
  locale: string
  d: Dictionary['shopifyPrivacy']
}) {
  return (
    <>
      {rows.length === 0 && <p>{d.empty}</p>}
      {rows.map((row) => (
        <PrivacyCard
          key={`${row.id}:${row.revision}`}
          row={row}
          tenantId={tenantId}
          locale={locale}
          d={d}
        />
      ))}
    </>
  )
}
function PrivacyCard({
  row,
  tenantId,
  locale,
  d,
}: {
  row: PrivacyRequestRow
  tenantId: string | null
  locale: string
  d: Dictionary['shopifyPrivacy']
}) {
  const router = useRouter()
  const running = useRef(false)
  const [status, setStatus] = useState<'processing' | 'completed' | 'retained'>(
    'processing',
  )
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const retry = useRef<{ signature: string; id: string } | null>(null)
  const when = (value: string) =>
    new Date(value).toLocaleString(intlLocale(locale))
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    const signature = JSON.stringify({ status, note })
    if (retry.current?.signature !== signature)
      retry.current = { signature, id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/integrations/shopify/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: row.id,
          previousId: row.revision,
          id: retry.current.id,
          status,
          note,
        }),
      })
      if (!response.ok) {
        setError(response.status === 409 ? d.conflict : d.failed)
        return
      }
      router.refresh()
    } catch {
      setError(d.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form">
      <h2>{d.topics[row.topic]}</h2>
      <p>
        {row.shopDomain} · {d.statuses[row.status]}
      </p>
      <p>
        {d.received}: {when(row.receivedAt)} · {d.due}: {when(row.dueAt)}
      </p>
      <details>
        <summary>{d.details}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(row.details, null, 2)}
        </pre>
      </details>
      <details>
        <summary>{d.history}</summary>
        {row.history.map((h, i) => (
          <p key={i}>
            {when(h.at)} · {d.statuses[h.status]} · {h.note}
          </p>
        ))}
      </details>
      <form onSubmit={save}>
        <label htmlFor={`status-${row.id}`}>{d.outcome}</label>
        <select
          id={`status-${row.id}`}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          {(['processing', 'completed', 'retained'] as const).map((s) => (
            <option key={s} value={s}>
              {d.statuses[s]}
            </option>
          ))}
        </select>
        <label htmlFor={`note-${row.id}`}>{d.note}</label>
        <textarea
          id={`note-${row.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          maxLength={1000}
        />
        <p>{d.noteHint}</p>
        <Button disabled={busy || !note.trim()}>{d.save}</Button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  )
}
