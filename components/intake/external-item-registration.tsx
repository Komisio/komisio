'use client'
import { useRef, useState } from 'react'
import type { z } from 'zod'
import type { Dictionary } from '@/lib/i18n'
import type { externalRegistrationCommand } from '@/lib/engine/external-item-registration'
import {
  externalOfferAmount,
  externalOfferOre,
} from '@/lib/platform/external-offer-amount'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import styles from './external-request-review.module.css'

export function ExternalItemRegistration({
  tenantId,
  guaranteeId,
  description,
  priceOre,
  d,
  leaveWarning,
}: {
  tenantId: string
  guaranteeId: string
  description: string
  priceOre: string
  d: Dictionary['externalOffers']
  leaveWarning: string
}) {
  const router = useRouter()
  const pending = useRef<z.infer<typeof externalRegistrationCommand> | null>(
    null,
  )
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [changed, setChanged] = useState(false)
  const [error, setError] = useState('')
  useUnsavedChanges(!saved && (dirty || locked) ? leaveWarning : null)
  return (
    <details>
      <summary>{d.register}</summary>
      <form
        onChange={() => setDirty(true)}
        onSubmit={async (e) => {
          e.preventDefault()
          if (running.current || saved || changed) return
          if (!pending.current) {
            const fields = new FormData(e.currentTarget)
            const price = externalOfferOre(String(fields.get('price')))
            if (!price || BigInt(price) > 99999999n) {
              setError(d.registrationPriceInvalid)
              return
            }
            pending.current = {
              tenantId,
              guaranteeId,
              commandId: crypto.randomUUID(),
              description: String(fields.get('description')).trim(),
              priceOre: price,
            }
          }
          running.current = true
          setBusy(true)
          setLocked(true)
          setError('')
          try {
            const response = await fetch('/api/intake/requests/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pending.current),
            })
            const result = await response.json()
            if (
              !response.ok ||
              result.id !== pending.current.commandId ||
              typeof result.itemId !== 'string'
            ) {
              if (
                response.status === 409 &&
                ['REQUEST_CHANGED', 'TENANT_CHANGED'].includes(result.error)
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
          <div className={styles.amounts}>
            <label>
              {d.itemDescription}
              <input
                name="description"
                pattern=".*\S.*"
                defaultValue={description}
                required
                maxLength={1000}
              />
            </label>
            <label>
              {d.registrationPrice}
              <input
                name="price"
                inputMode="decimal"
                defaultValue={externalOfferAmount(priceOre).replace(' SEK', '')}
                required
                maxLength={10}
              />
            </label>
          </div>
          <p className="muted">{d.fixedHint}</p>
        </fieldset>
        {!saved && !changed ? (
          <button className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {busy ? '…' : locked ? d.retry : d.register}
          </button>
        ) : null}
        {saved ? <p role="status">{d.registered}</p> : null}
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
    </details>
  )
}
