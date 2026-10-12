'use client'
import { useBusyTransition as useTransition } from '@/components/platform/work-activity'
import { useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import { ReloadAction } from './reload-action'
import {
  NavigationLink,
  useUnsavedChanges,
} from '@/components/platform/navigation-warning'
import { useFormDirty } from '@/components/platform/use-form-dirty'

type D = Dictionary['payouts']

/** Staff records a payout request on the seller's behalf; the seller app requests later. */
export function PayoutRequestForm({
  tenantId,
  currency,
  sellers,
  d,
  intake,
  leaveUnsaved,
}: {
  tenantId: string
  currency: string
  sellers: { id: string; name: string; availableOre: number }[]
  d: D
  intake: Dictionary['intake']
  leaveUnsaved?: string
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [priceError, setPriceError] = useState('')
  const [saved, setSaved] = useState(false)
  const submittedFields = useRef<FormData | null>(null)
  const [submittedSellers, setSubmittedSellers] = useState(sellers)
  const displayedSellers = action.locked ? submittedSellers : sellers
  const formRef = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(formRef)
  useUnsavedChanges(
    !action.needsReload && (dirty || action.locked)
      ? (leaveUnsaved ?? null)
      : null,
  )
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      f =
        action.locked && submittedFields.current
          ? submittedFields.current
          : new FormData(form)
    setPriceError('')
    let amount: string
    try {
      amount = exactPrice(String(f.get('amount') ?? ''))
    } catch {
      setPriceError(d.amountInvalid)
      return
    }
    submittedFields.current = f
    if (!action.locked) setSubmittedSellers(sellers)
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
      submittedFields.current = null
      setRequestId(crypto.randomUUID())
      form.reset()
      const cleared = new FormData()
      cleared.append('seller', sellers[0]?.id ?? '')
      cleared.append('amount', '')
      resetDirty(cleared)
      router.refresh()
    }
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onChange={() => {
        if (!action.locked) setSaved(false)
        checkDirty()
      }}
    >
      {displayedSellers.length === 0 && <p role="status">{d.requestNone}</p>}
      {displayedSellers.length > 0 && (
        <>
          <p>{d.requestHint}</p>
          <fieldset
            className="intake-fields"
            data-draft-readiness
            disabled={!ready || action.busy || action.locked}
          >
            <div className="field">
              <label htmlFor="payout-seller">{d.seller}</label>
              <select id="payout-seller" name="seller" required>
                {displayedSellers.map((s) => (
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
        </>
      )}
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && <ReloadAction label={intake.reload} />}
      {displayedSellers.length > 0 && (
        <Button
          type="submit"
          disabled={!ready || action.busy || action.needsReload}
        >
          {action.busy ? intake.busy : action.locked ? intake.retry : d.request}
        </Button>
      )}
      {saved && (
        <>
          <p role="status">{d.requested}</p>
          <NavigationLink
            className="text-link"
            href="/intake/payouts#payouts-open"
          >
            {d.viewOpen}
          </NavigationLink>
        </>
      )}
    </form>
  )
}

const subscribeReady = () => () => {}
const clientReady = () => true
const serverReady = () => false
// The engine already limits a single settlement command to one hundred sellers.
const settlementLimit = 100
const candidatePageSize = 25

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
  leaveUnsaved,
  paging,
}: {
  tenantId: string
  currency: string
  candidates: { sellerId: string; name: string; availableOre: number }[]
  d: D
  intake: Dictionary['intake']
  leaveUnsaved?: string
  paging: Dictionary['sellersList']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady)
  const [refreshing, startRefresh] = useTransition()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [initialSelected, setInitialSelected] = useState(
    () => new Set(candidates.slice(0, settlementLimit).map((c) => c.sellerId)),
  )
  const [selected, setSelected] = useState(() => new Set(initialSelected))
  const [page, setPage] = useState(1)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [submittedCandidates, setSubmittedCandidates] = useState(candidates)
  const displayedCandidates = action.locked ? submittedCandidates : candidates
  const eligibleIds = new Set(displayedCandidates.map((c) => c.sellerId))
  const chosen = displayedCandidates.filter((c) => selected.has(c.sellerId))
  const dirty =
    reason !== '' ||
    confirmed ||
    selected.size !== initialSelected.size ||
    [...selected].some((id) => !initialSelected.has(id))
  useUnsavedChanges(
    !saved && !action.needsReload && (dirty || action.locked)
      ? (leaveUnsaved ?? null)
      : null,
  )
  const totalOre = chosen.reduce((sum, c) => sum + c.availableOre, 0)
  const pages = Math.max(
    1,
    Math.ceil(displayedCandidates.length / candidatePageSize),
  )
  const currentPage = Math.min(page, pages)
  const shown = displayedCandidates.slice(
    (currentPage - 1) * candidatePageSize,
    currentPage * candidatePageSize,
  )
  const pager =
    pages > 1 ? (
      <nav className="seller-directory-pagination" aria-label={d.settleHeading}>
        <Button
          type="button"
          variant="secondary"
          disabled={currentPage === 1}
          onClick={() => setPage(currentPage - 1)}
        >
          {paging.previousPage}
        </Button>
        <span>
          {paging.pageOf
            .replace('{page}', String(currentPage))
            .replace('{pages}', String(pages))}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={currentPage === pages}
          onClick={() => setPage(currentPage + 1)}
        >
          {paging.nextPage}
        </Button>
      </nav>
    ) : null
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !ready ||
      action.busy ||
      action.needsReload ||
      saved ||
      chosen.length > settlementLimit
    )
      return
    if (!action.locked) setSubmittedCandidates(candidates)
    if (
      (action.locked || chosen.length > 0) &&
      (await action.run({
        action: 'settlePayouts',
        tenantId,
        requestId,
        reason,
        sellers: chosen.map((c) => ({
          sellerId: c.sellerId,
          amount: (c.availableOre / 100).toFixed(2),
        })),
      }))
    ) {
      setSaved(true)
      setRequestId(crypto.randomUUID())
      setReason('')
      setConfirmed(false)
      startRefresh(() => router.refresh())
    }
  }
  return (
    <form onSubmit={submit}>
      {candidates.length === 0 && !action.locked && <p>{d.settleEmpty}</p>}
      {displayedCandidates.length > 0 && !saved && (
        <fieldset
          className="intake-fields"
          disabled={!ready || action.busy || action.locked}
        >
          <div className="settlement-selection-summary">
            <strong>
              {d.selectedCandidates
                .replace('{selected}', String(chosen.length))
                .replace('{total}', String(displayedCandidates.length))}
            </strong>
            {displayedCandidates.length > candidatePageSize && (
              <div className="workspace-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setSelected(
                      new Set(
                        displayedCandidates
                          .slice(0, settlementLimit)
                          .map((c) => c.sellerId),
                      ),
                    )
                  }
                >
                  {d.selectCandidates}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelected(new Set())}
                >
                  {d.clearCandidates}
                </Button>
              </div>
            )}
          </div>
          {displayedCandidates.length > settlementLimit && (
            <p className="muted">{d.candidateLimit}</p>
          )}
          {pager}
          {shown.map((c) => (
            <label className="intake-confirm" key={c.sellerId}>
              <input
                type="checkbox"
                name="seller"
                value={c.sellerId}
                checked={selected.has(c.sellerId)}
                disabled={
                  !selected.has(c.sellerId) && chosen.length >= settlementLimit
                }
                onChange={(event) => {
                  const checked = event.target.checked
                  setSelected((previous) => {
                    const next = new Set(
                      [...previous].filter((id) => eligibleIds.has(id)),
                    )
                    if (checked && next.size < settlementLimit)
                      next.add(c.sellerId)
                    else if (!checked) next.delete(c.sellerId)
                    return next
                  })
                }}
              />
              {c.name} · {(c.availableOre / 100).toFixed(2)} {currency}
            </label>
          ))}
          {pager}
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
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <label className="intake-confirm">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {d.settleConfirm}
          </label>
        </fieldset>
      )}
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && <ReloadAction label={intake.reload} />}
      {!saved && displayedCandidates.length > 0 && (
        <Button
          type="submit"
          disabled={
            !ready ||
            action.busy ||
            action.needsReload ||
            chosen.length === 0 ||
            chosen.length > settlementLimit
          }
        >
          {action.busy
            ? intake.busy
            : action.locked
              ? intake.retry
              : d.settle.replace('{count}', String(chosen.length))}
        </Button>
      )}
      {saved && (
        <>
          <p role="status">{d.settled}</p>
          {candidates.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={refreshing}
              onClick={() => {
                const next = new Set(
                  candidates.slice(0, settlementLimit).map((c) => c.sellerId),
                )
                setInitialSelected(next)
                setSelected(new Set(next))
                setPage(1)
                setReason('')
                setConfirmed(false)
                setSaved(false)
              }}
            >
              {d.prepareMore}
            </Button>
          )}
          <NavigationLink
            className="text-link"
            href="/intake/payouts#payouts-open"
          >
            {d.viewOpen}
          </NavigationLink>
        </>
      )}
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
  leaveUnsaved,
}: {
  tenantId: string
  payoutId: string
  status: 'requested' | 'approved'
  d: D
  intake: Dictionary['intake']
  leaveUnsaved?: string
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty } = useFormDirty(formRef)
  useUnsavedChanges(
    !done && !action.needsReload && (dirty || action.locked)
      ? (leaveUnsaved ?? null)
      : null,
  )
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The retry button has no new decision; the hook owns the frozen command.
    if (action.locked) {
      if (await action.run({})) {
        setDone(true)
        router.refresh()
      }
      return
    }
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
    <form ref={formRef} onSubmit={submit} onChange={checkDirty}>
      <fieldset
        className="intake-fields"
        data-draft-readiness
        disabled={
          !ready || action.busy || action.locked || action.needsReload || done
        }
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
      {action.needsReload && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {intake.reload}
        </Button>
      )}
      {!done && (
        <div className="row">
          {action.locked && !action.needsReload ? (
            <Button type="submit" disabled={action.busy}>
              {action.busy ? intake.busy : intake.retry}
            </Button>
          ) : (
            <>
              {status === 'requested' ? (
                <Button
                  type="submit"
                  value="approve"
                  disabled={!ready || action.busy || action.needsReload}
                >
                  {action.busy ? intake.busy : d.approve}
                </Button>
              ) : (
                <Button
                  type="submit"
                  value="paid"
                  disabled={!ready || action.busy || action.needsReload}
                >
                  {action.busy ? intake.busy : d.markPaid}
                </Button>
              )}
              <Button
                type="submit"
                value="reject"
                variant="secondary"
                disabled={!ready || action.busy || action.needsReload}
              >
                {d.reject}
              </Button>
            </>
          )}
        </div>
      )}
    </form>
  )
}
