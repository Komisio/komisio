'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'

type EconomyAction =
  | { action: 'requestPayout'; amountOre: number }
  | { action: 'notifications'; enabled: boolean }
type Feedback = {
  action: EconomyAction['action']
  kind: 'success' | 'error'
  text: string
}

export function SellerEconomyForms({
  tenantId,
  sellerId,
  currency,
  availableOre,
  thresholdOre,
  enabled,
  d,
}: {
  tenantId: string
  sellerId: string
  currency: string
  availableOre: number
  thresholdOre: number
  enabled: boolean
  d: Dictionary['sellerPortal']
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const retry = useRef<{ key: string; id: string } | null>(null)
  const payoutForm = useRef<HTMLFormElement>(null)
  const canRequest = availableOre > 0 && availableOre >= thresholdOre
  const amount = (ore: number) => `${(ore / 100).toFixed(2)} ${currency}`
  const payoutError = (code: keyof typeof d.payoutErrors) =>
    setFeedback({
      action: 'requestPayout',
      kind: 'error',
      text: d.payoutErrors[code],
    })
  function responseFor(action: EconomyAction['action']) {
    return feedback?.action === action ? (
      <p
        id={action === 'requestPayout' ? 'payout-feedback' : undefined}
        role={feedback.kind === 'error' ? 'alert' : 'status'}
      >
        {feedback.text}
      </p>
    ) : null
  }
  async function submit(payload: EconomyAction) {
    setBusy(true)
    setFeedback(null)
    const key = JSON.stringify(payload)
    const id =
      retry.current?.key === key ? retry.current.id : crypto.randomUUID()
    retry.current = { key, id }
    try {
      const r = await fetch('/api/seller/economy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sellerId, requestId: id, ...payload }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'REQUEST_FAILED',
        )
      }
      retry.current = null
      if (payload.action === 'requestPayout') payoutForm.current?.reset()
      setFeedback({
        action: payload.action,
        kind: 'success',
        text: payload.action === 'requestPayout' ? d.payoutRequested : d.saved,
      })
      router.refresh()
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (
        payload.action === 'requestPayout' &&
        Object.hasOwn(d.payoutErrors, code)
      ) {
        payoutError(code as keyof typeof d.payoutErrors)
        // The server remains authoritative if the balance or policy changed.
        if (
          code === 'PAYOUT_EXCEEDS_BALANCE' ||
          code === 'PAYOUT_BELOW_THRESHOLD'
        )
          router.refresh()
      } else {
        setFeedback({
          action: payload.action,
          kind: 'error',
          text:
            payload.action === 'requestPayout' ? d.error : d.preferenceError,
        })
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="intake-grid">
      <section
        id="portal-payout-request"
        tabIndex={-1}
        className="card intake-form"
        aria-label={d.request}
      >
        <h2>{d.request}</h2>
        {canRequest ? (
          <form
            ref={payoutForm}
            onSubmit={(e) => {
              e.preventDefault()
              const value = String(
                new FormData(e.currentTarget).get('amount'),
              ).trim()
              if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(value)) {
                payoutError('INVALID_INPUT')
                return
              }
              const [whole, fraction = ''] = value.replace(',', '.').split('.')
              const amountOre =
                Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
              if (amountOre <= 0) return payoutError('INVALID_INPUT')
              if (amountOre < thresholdOre)
                return payoutError('PAYOUT_BELOW_THRESHOLD')
              if (amountOre > availableOre)
                return payoutError('PAYOUT_EXCEEDS_BALANCE')
              void submit({ action: 'requestPayout', amountOre })
            }}
          >
            <p>{d.notice}</p>
            <p id="payout-limits">
              {d.threshold}: {amount(thresholdOre)} · {d.available}:{' '}
              {amount(availableOre)}
            </p>
            <label htmlFor="payout-amount">
              {d.amount.replace('{currency}', currency)}
            </label>
            <input
              id="payout-amount"
              name="amount"
              inputMode="decimal"
              required
              disabled={busy}
              aria-invalid={
                feedback?.action === 'requestPayout' &&
                feedback.kind === 'error'
              }
              aria-describedby={`payout-limits${feedback?.action === 'requestPayout' ? ' payout-feedback' : ''}`}
            />
            <Button type="submit" disabled={busy}>
              {d.request}
            </Button>
          </form>
        ) : (
          <p>
            {availableOre <= 0
              ? d.noPayoutBalance
              : d.payoutBelowThreshold.replace(
                  '{minimum}',
                  amount(thresholdOre),
                )}
          </p>
        )}
        {responseFor('requestPayout')}
      </section>
      <form
        className="card intake-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit({
            action: 'notifications',
            enabled: new FormData(e.currentTarget).get('emails') === 'on',
          })
        }}
      >
        <label className="row">
          <input
            type="checkbox"
            name="emails"
            defaultChecked={enabled}
            disabled={busy}
          />
          {d.emails}
        </label>
        <Button type="submit" disabled={busy}>
          {d.save}
        </Button>
        {responseFor('notifications')}
      </form>
    </div>
  )
}
