'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
export function SellerResponse({
  token,
  reviewId,
  d,
}: {
  token: string
  reviewId: string
  d: Dictionary
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [checked, setChecked] = useState(false)
  const request = useRef<{
    id: string
    decision: 'approve' | 'decline'
  } | null>(null)
  const router = useRouter()
  async function respond(decision: 'approve' | 'decline') {
    setBusy(true)
    setError('')
    if (!request.current || request.current.decision !== decision)
      request.current = { id: crypto.randomUUID(), decision }
    try {
      const response = await fetch('/api/seller/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          reviewId,
          requestId: request.current.id,
          decision,
        }),
      })
      if (!response.ok) {
        setError(d.reviewResponseError)
        router.refresh()
        return
      }
      router.refresh()
    } catch {
      setError(d.reviewResponseError)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <label className="row">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {d.reviewConfirm}
      </label>
      <div className="row wrap">
        <Button disabled={busy || !checked} onClick={() => respond('approve')}>
          {d.reviewApprove}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => respond('decline')}
        >
          {d.reviewDecline}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
