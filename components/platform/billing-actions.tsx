'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { PlanStatus } from '@/lib/engine/plans'

/** Subscribe through Stripe Checkout, or open the customer portal; owner only. */
export function BillingActions({
  tenantId,
  status,
  configured,
  outcome,
  d,
}: {
  tenantId: string
  status: PlanStatus
  configured: boolean
  outcome: string | null
  d: Dictionary['plans']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const errors = d.errors as Record<string, string>
  async function go(action: 'checkout' | 'portal') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action }),
      })
      const body = await r.json()
      if (!r.ok || typeof body.url !== 'string') {
        setError(errors[body.error] ?? errors.REQUEST_FAILED)
        return
      }
      window.location.assign(body.url)
    } catch {
      setError(errors.REQUEST_FAILED)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const onStripe = status.provider === 'stripe'
  const canSubscribe =
    !onStripe && ['trial', 'read_only', 'active'].includes(status.state)
  return (
    <div>
      {outcome === 'success' && <p role="status">{d.checkoutSuccess}</p>}
      {outcome === 'cancelled' && <p role="status">{d.checkoutCancelled}</p>}
      {!configured ? (
        <p>
          <small>{d.notConfigured}</small>
        </p>
      ) : (
        <div className="row wrap">
          {canSubscribe && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void go('checkout')}
            >
              {busy ? d.busy : d.subscribe}
            </Button>
          )}
          {onStripe && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void go('portal')}
            >
              {busy ? d.busy : d.manageSubscription}
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
