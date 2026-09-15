'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { FortnoxSendRow } from '@/lib/engine/fortnox-vouchers'

export function FortnoxReconcile({
  tenantId,
  send,
  d,
}: {
  tenantId: string
  send: FortnoxSendRow
  d: Dictionary['fortnox']
}) {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <details>
      <summary>{d.reconcileTitle}</summary>
      <p>{d.reconcileHint}</p>
      <p>
        {d.databaseNumber}: {send.database_number}
      </p>
      <form
        aria-label={d.reconcileTitle}
        onSubmit={async (event) => {
          event.preventDefault()
          if (running.current) return
          running.current = true
          setBusy(true)
          setError('')
          const fields = new FormData(event.currentTarget)
          try {
            const response = await fetch('/api/integrations/fortnox', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'confirmVoucher',
                tenantId,
                sendId: send.id,
                voucherSeries: fields.get('series'),
                voucherNumber: Number(fields.get('number')),
                financialYear: Number(fields.get('year')),
                evidence: fields.get('evidence'),
              }),
            })
            const body = await response.json()
            if (!response.ok || body.status !== 'sent') {
              setError(
                (d.errors as Record<string, string>)[body.error] ??
                  d.connectionFailed,
              )
              return
            }
            router.refresh()
          } catch {
            setError(d.connectionFailed)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        <label>
          {d.reconcileSeries}
          <input name="series" required maxLength={10} autoComplete="off" />
        </label>
        <label>
          {d.reconcileNumber}
          <input
            name="number"
            type="number"
            required
            min={1}
            max={2147483647}
            step={1}
          />
        </label>
        <label>
          {d.reconcileYear}
          <input
            name="year"
            type="number"
            required
            min={1}
            max={2147483647}
            step={1}
          />
        </label>
        <label>
          {d.reconcileEvidence}
          <textarea name="evidence" required maxLength={500} />
        </label>
        <p>{d.reconcileNoAbsent}</p>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>
          {d.reconcileConfirm}
        </Button>
      </form>
    </details>
  )
}
