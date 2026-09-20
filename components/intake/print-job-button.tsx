'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { Printer } from '@/lib/engine/printing'
import { Button } from '@/components/ui/button'

/** Queues one label for a store printer; the local agent prints it. */
export function PrintJobButton({
  tenantId,
  printers,
  kind,
  referenceKind,
  referenceId,
  d,
  intake,
  compact = false,
}: {
  tenantId: string
  printers: Printer[]
  kind: 'bag' | 'garment' | 'item' | 'onboarding' | 'markdown'
  referenceKind: 'bag_receipt' | 'garment_receipt' | 'item' | 'seller'
  referenceId: string
  d: Dictionary['printing']
  intake: Dictionary['intake']
  compact?: boolean
}) {
  const router = useRouter()
  const active = printers.filter((p) => p.active)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  if (active.length === 0) return <p>{d.noPrinters}</p>
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId,
          printerId: String(f.get('printer')),
          kind,
          referenceKind,
          referenceId,
          copies: Number(f.get('copies') ?? 1),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(
          ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
            ? intake.denied
            : intake.failed,
        )
        return
      }
      setDone(true)
      setRequestId(crypto.randomUUID())
      router.refresh()
    } catch {
      setError(intake.retry)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={submit}
      className={compact ? 'label-print-form no-print' : 'row wrap no-print'}
    >
      <label htmlFor={`printer-${referenceId}`}>{d.printer}</label>
      <select id={`printer-${referenceId}`} name="printer" disabled={busy}>
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label htmlFor={`copies-${referenceId}`}>{d.copies}</label>
      <input
        id={`copies-${referenceId}`}
        name="copies"
        type="number"
        min={1}
        max={20}
        defaultValue={1}
        disabled={busy}
      />
      <Button
        type="submit"
        variant={compact ? 'primary' : 'secondary'}
        disabled={busy}
      >
        {busy ? intake.busy : d.queue}
      </Button>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{d.queued}</p>}
    </form>
  )
}
