'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
export function SubmissionNotification({
  tenantId,
  reviewId,
  status,
  d,
}: {
  tenantId: string
  reviewId: string
  status: string | null
  d: Dictionary['submissions']
}) {
  const [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState(status),
    router = useRouter()
  return (
    <div className="submission-notification">
      <small>{outcome === 'sent' ? d.replySent : d.replyNotSent}</small>
      {!outcome && (
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await fetch('/api/intake/submissions/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId, reviewId }),
              })
              const v = await r.json()
              if (!r.ok) throw Error()
              setOutcome(v.delivery === 'failed' ? null : v.delivery)
              router.refresh()
            } catch {
              setOutcome(null)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '…' : d.notifySeller}
        </button>
      )}
    </div>
  )
}
