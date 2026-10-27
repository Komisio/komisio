'use client'
import { SellerSection } from '@/components/seller/section'
import { useBusyState } from '@/components/platform/work-activity'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary, Locale } from '@/lib/i18n'
import { economyFormat } from '@/lib/intake/economy-format'

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
  locale = 'sv',
  availableOre,
  reservedOre = 0,
  thresholdOre,
  enabled,
  d,
  recovery,
  view = 'all',
}: {
  tenantId: string
  sellerId: string
  locale?: Locale
  currency: string
  reservedOre?: number
  availableOre: number
  thresholdOre: number
  enabled: boolean
  d: Dictionary['sellerPortal']
  recovery: Pick<Dictionary['intake'], 'retry' | 'reload' | 'busy' | 'denied'>
  view?: 'all' | 'payout' | 'notifications'
}) {
  const router = useRouter()
  const [busy, setBusy] = useBusyState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pendingPreference, setPendingPreference] = useState<boolean | null>(
    null,
  )
  const [locked, setLocked] = useState<
    Partial<Record<EconomyAction['action'], boolean>>
  >({})
  const [needsReload, setNeedsReload] = useState<
    Partial<Record<EconomyAction['action'], boolean>>
  >({})
  const running = useRef(false)
  const retries = useRef<
    Partial<
      Record<EconomyAction['action'], { payload: EconomyAction; id: string }>
    >
  >({})
  const payoutForm = useRef<HTMLFormElement>(null)
  const canRequest = availableOre > 0 && availableOre >= thresholdOre
  const amount = (ore: number) => economyFormat(locale).money(ore, currency)
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
    if (running.current || needsReload[payload.action]) return
    const request = retries.current[payload.action] ?? {
      payload,
      id: crypto.randomUUID(),
    }
    retries.current[payload.action] = request
    if (request.payload.action === 'notifications')
      setPendingPreference(request.payload.enabled)
    running.current = true
    setBusy(true)
    setLocked((previous) => ({ ...previous, [payload.action]: true }))
    setFeedback(null)
    try {
      const r = await fetch('/api/seller/economy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sellerId,
          requestId: request.id,
          ...request.payload,
        }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        const answered = r.status >= 400 && r.status < 500
        const code =
          answered && typeof body?.error === 'string'
            ? body.error
            : 'REQUEST_FAILED'
        if (
          [
            'INVALID_INPUT',
            'PAYOUT_EXCEEDS_BALANCE',
            'PAYOUT_BELOW_THRESHOLD',
          ].includes(code)
        ) {
          delete retries.current[payload.action]
          if (payload.action === 'notifications') setPendingPreference(null)
          setLocked((previous) => ({ ...previous, [payload.action]: false }))
        } else if (
          ['FORBIDDEN', 'AUTH_REQUIRED', 'REQUEST_CONFLICT'].includes(code)
        ) {
          setNeedsReload((previous) => ({
            ...previous,
            [payload.action]: true,
          }))
        }
        throw new Error(code)
      }
      if (body?.ok !== true || body?.id !== request.id)
        throw new Error('REQUEST_FAILED')
      delete retries.current[payload.action]
      if (payload.action === 'notifications') setPendingPreference(null)
      setLocked((previous) => ({ ...previous, [payload.action]: false }))
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
          text: ['FORBIDDEN', 'AUTH_REQUIRED'].includes(code)
            ? recovery.denied
            : payload.action === 'requestPayout'
              ? d.error
              : d.preferenceError,
        })
      }
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="intake-grid">
      {view !== 'notifications' && (
        <SellerSection
          id="portal-payout-request"
          tabIndex={-1}
          className="card intake-form"
          aria-label={d.request}
        >
          <h2>{d.available}</h2>
          <p className="seller-balance">{amount(availableOre)}</p>
          {reservedOre > 0 && (
            <p className="muted">
              {d.reserved}: {amount(reservedOre)}
            </p>
          )}
          {canRequest || locked.requestPayout ? (
            <form
              ref={payoutForm}
              onChange={() => {
                if (
                  !locked.requestPayout &&
                  feedback?.action === 'requestPayout'
                )
                  setFeedback(null)
              }}
              onSubmit={(e) => {
                e.preventDefault()
                const pending = retries.current.requestPayout
                if (pending) {
                  void submit(pending.payload)
                  return
                }
                const value = String(
                  new FormData(e.currentTarget).get('amount'),
                ).trim()
                if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(value)) {
                  payoutError('INVALID_INPUT')
                  return
                }
                const [whole, fraction = ''] = value
                  .replace(',', '.')
                  .split('.')
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
                disabled={busy || locked.requestPayout}
                aria-invalid={
                  feedback?.action === 'requestPayout' &&
                  feedback.kind === 'error'
                }
                aria-describedby={`payout-limits${feedback?.action === 'requestPayout' ? ' payout-feedback' : ''}`}
              />
              <Button
                type="submit"
                disabled={busy || needsReload.requestPayout}
              >
                {busy
                  ? recovery.busy
                  : locked.requestPayout
                    ? recovery.retry
                    : d.request}
              </Button>
              {needsReload.requestPayout && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  {recovery.reload}
                </Button>
              )}
            </form>
          ) : (
            <>
              {thresholdOre > 0 && (
                <progress
                  aria-label={d.threshold}
                  value={Math.max(0, availableOre)}
                  max={thresholdOre}
                />
              )}
              <p>
                {thresholdOre > 0
                  ? d.payoutRemaining
                      .replace(
                        '{remaining}',
                        amount(thresholdOre - availableOre),
                      )
                      .replace('{minimum}', amount(thresholdOre))
                  : d.noPayoutBalance}
              </p>
              <Button disabled>{d.request}</Button>
            </>
          )}
          {responseFor('requestPayout')}
        </SellerSection>
      )}
      {view !== 'payout' && (
        <form
          className="seller-email-setting"
          onChange={() => {
            if (!locked.notifications && feedback?.action === 'notifications')
              setFeedback(null)
          }}
          onSubmit={(e) => {
            e.preventDefault()
            void submit({
              action: 'notifications',
              enabled: new FormData(e.currentTarget).get('emails') === 'on',
            })
          }}
        >
          <label className="seller-email-checkbox">
            <input
              type="checkbox"
              name="emails"
              key={String(enabled)}
              defaultChecked={pendingPreference ?? enabled}
              disabled={busy || locked.notifications}
              onChange={(event) => {
                void submit({
                  action: 'notifications',
                  enabled: event.target.checked,
                })
              }}
            />
            {d.emails}
          </label>
          {locked.notifications && !needsReload.notifications && (
            <Button type="submit" disabled={busy}>
              {busy ? recovery.busy : recovery.retry}
            </Button>
          )}
          {needsReload.notifications && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {recovery.reload}
            </Button>
          )}
          {responseFor('notifications')}
        </form>
      )}
    </div>
  )
}
