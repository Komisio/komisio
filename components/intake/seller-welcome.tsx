'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { communicationStatus } from '@/lib/engine/communications'

export function SellerWelcome({
  tenantId,
  sellerId,
  status,
  hasEmail,
  d,
  failure,
  retry,
}: {
  tenantId: string
  sellerId: string
  status: string | null
  hasEmail: boolean
  d: Dictionary['communications']
  failure: string
  retry: string
}) {
  const router = useRouter()
  const pending = useRef<string | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState(status)
  return (
    <section aria-label={d.welcomeTitle}>
      <h3>{d.welcomeTitle}</h3>
      <p role="status">
        {!hasEmail
          ? d.noEmail
          : outcome
            ? d.outcomes[outcome as keyof typeof d.outcomes]
            : d.welcomeNotSent}
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!hasEmail || busy}
        onClick={async () => {
          if (running.current) return
          running.current = true
          setBusy(true)
          setError('')
          pending.current ??= crypto.randomUUID()
          try {
            const response = await fetch('/api/communications', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenantId,
                sellerId,
                requestId: pending.current,
                kind: 'message',
                welcome: true,
              }),
              signal: AbortSignal.timeout(20000),
            })
            const result = await response.json()
            if (
              !response.ok ||
              result.id !== pending.current ||
              !communicationStatus.safeParse(result.delivery).success
            ) {
              if (result.error === 'EMAIL_DAILY_CAP') {
                pending.current = null
                setError(d.dailyCap)
              } else setError(failure)
              return
            }
            setOutcome(result.delivery)
            pending.current = null
            router.refresh()
          } catch {
            setError(failure)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        {busy ? '…' : error ? retry : outcome ? d.welcomeResend : d.welcomeSend}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
