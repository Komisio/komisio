'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

type D = Dictionary['payouts']

/** Staff records a payout request on the seller's behalf; the seller app requests later. */
export function PayoutRequestForm({
  tenantId,
  currency,
  sellers,
  d,
  intake,
}: {
  tenantId: string
  currency: string
  sellers: { id: string; name: string; availableOre: number }[]
  d: D
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [priceError, setPriceError] = useState('')
  const [saved, setSaved] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      f = new FormData(form)
    setPriceError('')
    let amount: string
    try {
      amount = exactPrice(String(f.get('amount') ?? ''))
    } catch {
      setPriceError(d.amountInvalid)
      return
    }
    if (
      await action.run({
        action: 'requestPayout',
        tenantId,
        requestId,
        sellerId: String(f.get('seller')),
        amount,
      })
    ) {
      setSaved(true)
      setRequestId(crypto.randomUUID())
      form.reset()
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked}
      >
        <div className="field">
          <label htmlFor="payout-seller">{d.seller}</label>
          <select id="payout-seller" name="seller" required>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {(s.availableOre / 100).toFixed(2)} {currency}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="payout-amount">{d.amount}</label>
          <input
            id="payout-amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="100"
          />
          <small>{d.amountHint}</small>
          {priceError && <p role="alert">{priceError}</p>}
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.requestConfirm}
        </label>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      <Button type="submit" disabled={action.busy || action.needsReload}>
        {action.busy ? intake.busy : action.locked ? intake.retry : d.request}
      </Button>
      {saved && <p role="status">{d.requested}</p>}
    </form>
  )
}

/**
 * One batch for every selected candidate: the full available balance per
 * seller, requested and approved together. Refused whole by the engine if any
 * seller changed since the page loaded.
 */
export function SettlementForm({
  tenantId,
  currency,
  candidates,
  d,
  intake,
}: {
  tenantId: string
  currency: string
  candidates: { sellerId: string; name: string; availableOre: number }[]
  d: D
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [selected, setSelected] = useState(
    () => new Set(candidates.map((c) => c.sellerId)),
  )
  const [saved, setSaved] = useState(false)
  const chosen = candidates.filter((c) => selected.has(c.sellerId))
  const totalOre = chosen.reduce((sum, c) => sum + c.availableOre, 0)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      f = new FormData(form)
    if (
      chosen.length &&
      (await action.run({
        action: 'settlePayouts',
        tenantId,
        requestId,
        reason: String(f.get('reason') ?? ''),
        sellers: chosen.map((c) => ({
          sellerId: c.sellerId,
          amount: (c.availableOre / 100).toFixed(2),
        })),
      }))
    ) {
      setSaved(true)
      setRequestId(crypto.randomUUID())
      form.reset()
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || saved}
      >
        {candidates.map((c) => (
          <label className="intake-confirm" key={c.sellerId}>
            <input
              type="checkbox"
              name="seller"
              value={c.sellerId}
              checked={selected.has(c.sellerId)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(c.sellerId)
                else next.delete(c.sellerId)
                setSelected(next)
              }}
            />
            {c.name} · {(c.availableOre / 100).toFixed(2)} {currency}
          </label>
        ))}
        <p>
          {d.settleTotal}: {(totalOre / 100).toFixed(2)} {currency}
        </p>
        <div className="field">
          <label htmlFor="settle-reason">{d.settleReason}</label>
          <input
            id="settle-reason"
            name="reason"
            required
            maxLength={500}
            placeholder="September"
          />
          <small>{d.settleReasonHint}</small>
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.settleConfirm}
        </label>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {!saved && (
        <Button
          type="submit"
          disabled={action.busy || action.needsReload || chosen.length === 0}
        >
          {action.busy
            ? intake.busy
            : action.locked
              ? intake.retry
              : d.settle.replace('{count}', String(chosen.length))}
        </Button>
      )}
      {saved && <p role="status">{d.settled}</p>}
    </form>
  )
}

/** Approve, mark paid or reject one payout. Each submit is one replay-safe command. */
export function PayoutDecision({
  tenantId,
  payoutId,
  status,
  d,
  intake,
}: {
  tenantId: string
  payoutId: string
  status: 'requested' | 'approved'
  d: D
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const kind = submitter?.getAttribute('value') ?? 'approve'
    const reason = String(f.get('reason') ?? ''),
      reference = String(f.get('reference') ?? '')
    const command =
      kind === 'reject'
        ? { action: 'rejectPayout', tenantId, requestId, payoutId, reason }
        : kind === 'paid'
          ? {
              action: 'markPayoutPaid',
              tenantId,
              requestId,
              payoutId,
              reference,
              reason,
            }
          : { action: 'approvePayout', tenantId, requestId, payoutId, reason }
    if (await action.run(command)) {
      setDone(true)
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || done}
      >
        {status === 'approved' && (
          <div className="field">
            <label htmlFor={`ref-${payoutId}`}>{d.reference}</label>
            <input
              id={`ref-${payoutId}`}
              name="reference"
              maxLength={200}
              placeholder="BG 2026-09-13-1"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={`reason-${payoutId}`}>{d.reason}</label>
          <input id={`reason-${payoutId}`} name="reason" maxLength={500} />
        </div>
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {!done && (
        <div className="row">
          {status === 'requested' ? (
            <Button
              type="submit"
              value="approve"
              disabled={action.busy || action.needsReload}
            >
              {action.busy ? intake.busy : d.approve}
            </Button>
          ) : (
            <Button
              type="submit"
              value="paid"
              disabled={action.busy || action.needsReload}
            >
              {action.busy ? intake.busy : d.markPaid}
            </Button>
          )}
          <Button
            type="submit"
            value="reject"
            variant="secondary"
            disabled={action.busy || action.needsReload}
          >
            {d.reject}
          </Button>
        </div>
      )}
    </form>
  )
}
