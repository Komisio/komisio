'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { communicationStatus } from '@/lib/engine/communications'
import { NavigationLink } from '@/components/platform/navigation-warning'
export function SubmissionNotification({
  tenantId,
  reviewId,
  status,
  sellerId,
  canSend,
  d,
}: {
  tenantId: string
  reviewId: string
  status: string | null
  sellerId: string
  canSend: boolean
  d: Dictionary
}) {
  const [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState(status),
    [uncertain, setUncertain] = useState(false),
    router = useRouter()
  const running = useRef(false)
  const parsed = communicationStatus.safeParse(outcome)
  const label =
    outcome === null
      ? d.communications.welcomeNotSent
      : d.communications.outcomes[parsed.success ? parsed.data : 'unconfirmed']
  return (
    <div className="submission-notification">
      <small role="status">
        {d.submissions.replyDelivery}: {label}
      </small>
      {outcome === null && !uncertain && canSend && (
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={async () => {
            if (running.current) return
            running.current = true
            setBusy(true)
            try {
              const r = await fetch('/api/intake/submissions/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId, reviewId }),
              })
              const v = await r.json()
              const delivery = communicationStatus.safeParse(v.delivery)
              if (!r.ok || !delivery.success) throw Error()
              setOutcome(delivery.data)
              router.refresh()
            } catch {
              setOutcome('unconfirmed')
              setUncertain(true)
            } finally {
              running.current = false
              setBusy(false)
            }
          }}
        >
          {busy ? d.loading : d.submissions.notifySeller}
        </button>
      )}
      {(uncertain || outcome === 'queued') && (
        <button
          className="btn btn-secondary"
          onClick={() => window.location.reload()}
        >
          {d.intake.reload}
        </button>
      )}
      <NavigationLink href={`/intake/sellers/${sellerId}#seller-communication`}>
        {d.sellerWorkspace.communication}
      </NavigationLink>
    </div>
  )
}
