'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'

export function AgreementAcceptance({
  tenantId,
  sellerId,
  agreementId,
  translationId,
  d,
}: {
  tenantId: string
  sellerId: string
  agreementId: string
  translationId?: string | null
  d: Dictionary
}) {
  const router = useRouter()
  const requestId = useRef<string | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  async function accept() {
    if (running.current || accepted || stale) return
    running.current = true
    setBusy(true)
    setError('')
    requestId.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/seller/agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sellerId,
          agreementId,
          translationId,
          requestId: requestId.current,
        }),
      })
      const result = await response.json()
      if (!response.ok || result.ok !== true || typeof result.id !== 'string') {
        if (result.error === 'AGREEMENT_CHANGED') {
          setStale(true)
          setError(d.sellerAgreement.changed)
        } else setError(d.sellerAgreement.failed)
        return
      }
      setAccepted(true)
      router.refresh()
    } catch {
      setError(d.sellerAgreement.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="no-print">
      {accepted ? (
        <p role="status">{d.sellerAgreement.accepted}</p>
      ) : (
        <Button disabled={busy || stale} onClick={accept}>
          {busy ? d.loading : d.sellerAgreement.accept}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {stale && (
        <Button variant="secondary" onClick={() => router.refresh()}>
          {d.intake.reload}
        </Button>
      )}
    </div>
  )
}
