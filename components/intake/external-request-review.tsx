'use client'
import styles from './external-request-review.module.css'
import { useId, useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type { z } from 'zod'
import type { reviewExternalRequestCommand } from '@/lib/engine/external-item-offers'
import { externalOfferOre } from '@/lib/platform/external-offer-amount'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'

export function ExternalRequestReview({
  tenantId,
  requestId,
  previousOfferId,
  agreementId,
  d,
  leaveWarning,
}: {
  tenantId: string
  requestId: string
  previousOfferId: string | null
  agreementId: string | null
  d: Dictionary['externalOffers']
  leaveWarning: string
}) {
  const router = useRouter(),
    prefix = useId()
  const pending = useRef<z.infer<typeof reviewExternalRequestCommand> | null>(
    null,
  )
  const running = useRef(false)
  const [action, setAction] = useState<'offer' | 'decline'>('offer')
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false),
    [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [changed, setChanged] = useState(false)
  useUnsavedChanges(!saved && (dirty || locked) ? leaveWarning : null)
  return (
    <form
      onChange={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault()
        if (running.current || saved || changed) return
        if (!pending.current) {
          const fields = new FormData(e.currentTarget)
          const base = { tenantId, requestId, commandId: crypto.randomUUID() }
          if (action === 'offer') {
            const amount = externalOfferOre(String(fields.get('amount'))),
              price = externalOfferOre(String(fields.get('price')))
            if (!amount || !price || !agreementId) {
              setError(d.invalidAmount)
              return
            }
            pending.current = {
              ...base,
              action,
              previousOfferId,
              agreementVersionId: agreementId,
              sellerAmountOre: amount,
              expectedSalePriceOre: price,
            }
          } else
            pending.current = {
              ...base,
              action,
              note: String(fields.get('note') ?? '').trim(),
            }
        }
        running.current = true
        setBusy(true)
        setLocked(true)
        setError('')
        try {
          const response = await fetch('/api/intake/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pending.current),
          })
          const result = await response.json()
          if (!response.ok || result.id !== pending.current.commandId) {
            if (
              response.status === 409 &&
              [
                'REQUEST_CHANGED',
                'OFFER_ACTIVE',
                'OFFER_ACCEPTED',
                'AGREEMENT_CHANGED',
                'TENANT_CHANGED',
              ].includes(result.error)
            ) {
              setChanged(true)
              setError(d.changed)
              return
            }
            throw new Error('UNCONFIRMED')
          }
          setSaved(true)
          router.refresh()
        } catch {
          setError(d.failure)
        } finally {
          running.current = false
          setBusy(false)
        }
      }}
    >
      <fieldset disabled={locked} className="submission-fields">
        <div className={styles.mode}>
          {(['offer', 'decline'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`${prefix}-action`}
                checked={action === value}
                onChange={() => setAction(value)}
              />{' '}
              {value === 'offer' ? d.send : d.decline}
            </label>
          ))}
        </div>
        {action === 'offer' ? (
          <>
            {!agreementId ? <p>{d.noAgreement}</p> : null}
            <div className={styles.amounts}>
              <label>
                {d.sellerAmount}
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  maxLength={12}
                />
              </label>
              <label>
                {d.salePrice}
                <input
                  name="price"
                  inputMode="decimal"
                  required
                  maxLength={12}
                />
              </label>
            </div>
            <p className="muted">
              {d.fixedHint} {d.duration}
            </p>
          </>
        ) : (
          <label>
            {d.note}
            <textarea name="note" maxLength={1000} rows={2} />
          </label>
        )}
      </fieldset>
      {!saved && !changed ? (
        <button
          className="btn btn-primary"
          disabled={busy || (action === 'offer' && !agreementId)}
          aria-busy={busy}
        >
          {busy
            ? '…'
            : locked
              ? d.retry
              : action === 'offer'
                ? d.send
                : d.decline}
        </button>
      ) : null}
      {saved ? <p role="status">{d.saved}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {changed ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setDirty(false)
            setLocked(false)
            setSaved(true)
            router.refresh()
          }}
        >
          {d.reload}
        </button>
      ) : null}
    </form>
  )
}
