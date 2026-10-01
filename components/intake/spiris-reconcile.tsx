'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { SpirisSendRow } from '@/lib/engine/spiris-vouchers'

/** The owner confirms that a held send's voucher exists in Spiris; absence cannot be confirmed here. */
export function SpirisReconcile({
  tenantId,
  send,
  d,
}: {
  tenantId: string
  send: SpirisSendRow
  d: Dictionary['spiris']
}) {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <details>
      <summary>{d.reconcileTitle}</summary>
      <p>{d.reconcileHint}</p>
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
            const response = await fetch('/api/integrations/spiris', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'confirmVoucher',
                tenantId,
                sendId: send.id,
                voucherId: fields.get('voucherId') ?? '',
                voucherNumber: fields.get('number'),
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
          {d.reconcileNumber}
          <input name="number" required maxLength={40} autoComplete="off" />
        </label>
        <label>
          {d.reconcileVoucherId}
          <input name="voucherId" maxLength={80} autoComplete="off" />
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
