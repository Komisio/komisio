'use client'
import { useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import type { z } from 'zod'
import type { centralReviewCommand } from '@/lib/engine/central-item-review'
import {
  externalOfferAmount,
  externalOfferOre,
} from '@/lib/platform/external-offer-amount'
import { useBusyState } from '@/components/platform/work-activity'
import {
  useUnsavedChanges,
  NavigationLink,
} from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import { ExternalRequestQueue } from './external-request-queue'
import styles from './external-request-queue.module.css'

export function CentralRequestGroup(
  props: ComponentProps<typeof ExternalRequestQueue>,
) {
  const { rows, d, tenantId, write, leaveWarning } = props,
    t = d.fixed
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false),
    [saved, setSaved] = useState(false),
    [changed, setChanged] = useState(false)
  const [error, setError] = useState(''),
    [shippingStatus, setShippingStatus] = useState<string | null>(null)
  const pending = useRef<z.infer<typeof centralReviewCommand> | null>(null),
    running = useRef(false)
  useUnsavedChanges(
    !saved && (selected.length > 0 || locked) ? leaveWarning : null,
  )
  const first = rows[0],
    chosen = rows.filter((r) => selected.includes(r.id))
  const grams = chosen.reduce((n, r) => n + (r.selection_weight_g ?? 2000), 0)
  const total = chosen.reduce(
    (n, r) => n + BigInt(r.desired_price_ore ?? '0'),
    0n,
  )
  const canBook = chosen.length > 0 && grams <= 2500 && chosen.length <= 10
  async function submit(book: boolean) {
    if (running.current || saved || changed) return
    if (!pending.current) {
      const items = chosen.map((r) => ({
        requestId: r.id,
        expectedSalePriceOre:
          r.offer?.expectedSalePriceOre ?? externalOfferOre(prices[r.id] ?? ''),
      }))
      if (
        !items.length ||
        items.some((i) => !i.expectedSalePriceOre) ||
        !first.sender_revision ||
        (book && !canBook)
      ) {
        setError(d.invalidAmount)
        return
      }
      pending.current = {
        action: book ? 'approveAndBook' : 'approve',
        tenantId,
        commandId: crypto.randomUUID(),
        ownerId: first.owner_id,
        expectedRevision: first.sender_revision,
        items: items as { requestId: string; expectedSalePriceOre: string }[],
      }
    }
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    try {
      const response = await fetch('/api/intake/requests/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      const result = await response.json()
      if (!response.ok || result.id !== pending.current.commandId) {
        if (
          response.status === 409 &&
          [
            'PROFILE_CHANGED',
            'REQUEST_CHANGED',
            'PARCEL_EXISTS',
            'PARCEL_WEIGHT_LIMIT',
            'HANDOVER_CLOSED',
            'REQUEST_CONFLICT',
          ].includes(result.error)
        ) {
          setChanged(true)
          setError(
            result.error === 'PARCEL_WEIGHT_LIMIT' ? t.weightLimit : d.changed,
          )
          return
        }
        throw new Error('UNCONFIRMED')
      }
      setSaved(true)
      setShippingStatus(result.shippingStatus)
      router.refresh()
    } catch {
      setError(d.failure)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className={styles.sellerGroup}>
      <header className={styles.groupHeading}>
        <div>
          <h2>
            {first.sender_contact
              ? `${first.sender_contact.firstName} ${first.sender_contact.lastName}`
              : first.seller_name}
          </h2>
          <p>{t.intro}</p>
        </div>
        <NavigationLink
          href={`/intake/requests?owner=${encodeURIComponent(first.owner_id)}`}
        >
          {t.allItems}
        </NavigationLink>
      </header>
      {rows.map((row) => {
        const selectable =
          !row.parcel &&
          (row.queue_status === 'waiting' ||
            (row.offer?.status === 'accepted' &&
              row.offer.handover &&
              row.offer.handover.status === 'open'))
        const checked = selected.includes(row.id)
        return (
          <div
            className={styles.groupItem}
            key={`${row.id}:${row.queue_status}:${row.parcel?.id ?? ''}`}
          >
            {write && selectable ? (
              <label className={styles.selection}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked || (!checked && selected.length >= 10)}
                  onChange={() =>
                    setSelected((ids) =>
                      checked
                        ? ids.filter((id) => id !== row.id)
                        : [...ids, row.id],
                    )
                  }
                />
                <span>{t.select.replace('{item}', row.description)}</span>
              </label>
            ) : null}
            <ExternalRequestQueue {...props} rows={[row]} />
            {write && checked && !row.offer ? (
              <label className={styles.groupPrice}>
                {d.salePrice}
                <input
                  inputMode="decimal"
                  maxLength={12}
                  value={prices[row.id] ?? ''}
                  disabled={locked}
                  onChange={(e) =>
                    setPrices((p) => ({ ...p, [row.id]: e.target.value }))
                  }
                />
              </label>
            ) : null}
            {row.parcel ? (
              <p className={styles.parcelSummary}>
                {row.parcel.status === 'booked' ? t.booked : t.pending} ·{' '}
                {row.parcel.items.map((i) => i.description).join(' · ')}
              </p>
            ) : null}
          </div>
        )
      })}
      {write && selected.length > 0 ? (
        <div className={styles.groupActions}>
          <p>
            <strong>
              {t.selected.replace('{count}', String(selected.length))}
            </strong>{' '}
            · {externalOfferAmount(String(total))} ·{' '}
            {t.weight.replace('{grams}', String(grams))}
          </p>
          {grams > 2500 ? <p role="alert">{t.weightLimit}</p> : null}
          {!saved && !changed ? (
            locked ? (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void submit(false)}
              >
                {busy ? '…' : d.retry}
              </button>
            ) : (
              <div className={styles.groupButtons}>
                <button
                  className="btn btn-primary"
                  disabled={!canBook || busy}
                  onClick={() => void submit(true)}
                >
                  {t.approveBook}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void submit(false)}
                >
                  {t.approve}
                </button>
              </div>
            )
          ) : null}
          {saved ? (
            <p role="status">
              {shippingStatus === 'booked'
                ? t.booked
                : shippingStatus
                  ? t.pending
                  : t.approved}
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {changed ? (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSaved(true)
                router.refresh()
              }}
            >
              {d.reload}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
