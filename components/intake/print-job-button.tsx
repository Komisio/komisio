'use client'
import { useRef, useState } from 'react'
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
  const pending = useRef<string | null>(null)
  const running = useRef(false)
  const [locked, setLocked] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  if (active.length === 0) return <p>{d.noPrinters}</p>
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (running.current || needsReload) return
    const retrying = pending.current !== null
    const f = new FormData(event.currentTarget)
    const body =
      pending.current ??
      JSON.stringify({
        tenantId,
        requestId,
        printerId: String(f.get('printer')),
        kind,
        referenceKind,
        referenceId,
        copies: Number(f.get('copies') ?? 1),
      })
    pending.current = body
    running.current = true
    setLocked(true)
    setBusy(true)
    setError('')
    setDone(false)
    try {
      const response = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const result = await response.json()
      if (!response.ok) {
        // Only an answered first validation refusal allows changed fields.
        // A prior uncertain attempt may already have queued the job.
        if (response.status >= 400 && response.status < 500) {
          if (result?.error === 'INVALID_INPUT' && !retrying) {
            pending.current = null
            setLocked(false)
          } else {
            setNeedsReload(true)
          }
        }
        setError(
          ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result?.error)
            ? intake.denied
            : result?.error === 'TENANT_CHANGED'
              ? intake.changed
              : response.status === 400 && result?.error === 'INVALID_INPUT'
                ? intake.invalid
                : intake.failed,
        )
        return
      }
      if (result?.ok !== true || result?.id !== requestId) {
        setError(intake.failed)
        return
      }
      pending.current = null
      setLocked(false)
      setDone(true)
      setRequestId(crypto.randomUUID())
      router.refresh()
    } catch {
      setError(intake.retry)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={submit}
      className={compact ? 'label-print-form no-print' : 'row wrap no-print'}
    >
      <label htmlFor={`printer-${referenceId}`}>{d.printer}</label>
      <select id={`printer-${referenceId}`} name="printer" disabled={locked}>
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
        disabled={locked}
      />
      <Button
        type="submit"
        variant={compact ? 'primary' : 'secondary'}
        disabled={busy || needsReload}
      >
        {busy ? intake.busy : locked ? intake.retry : d.queue}
      </Button>
      {needsReload && !busy && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {intake.reload}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{d.queued}</p>}
    </form>
  )
}
