'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { HandoverCode } from './handover-code'
import { useRouter } from 'next/navigation'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import type { MyHandovers } from '@/lib/engine/handovers'

type HandoverChange =
  | {
      action: 'createHandover'
      kind: string
      estimatedItems: number
      note: string
    }
  | { action: 'cancelHandover'; handoverId: string }

type Outcome = {
  phase: 'idle' | 'busy' | 'uncertain' | 'stale' | 'confirmed'
  error?: string
}
const staleErrors = new Set([
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'HANDOVER_NOT_ENABLED',
  'HANDOVER_NOT_FOUND',
  'HANDOVER_DECIDED',
  'REQUEST_CONFLICT',
])

/** Announce a bag or box and follow it until the store has received it. */
export function SellerHandovers({
  tenantId,
  sellerId,
  handovers,
  locale,
  d,
  recovery,
}: {
  tenantId: string
  sellerId: string
  handovers: MyHandovers
  locale: string
  d: Dictionary['sellerPortal']
  recovery: Pick<Dictionary['intake'], 'busy' | 'retry' | 'reload' | 'invalid'>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [failedTarget, setFailedTarget] = useState<string | null>(null)
  const feedbackId = useId()
  const form = useRef<HTMLFormElement>(null)
  const focusReceipt = useRef<string | null>(null)
  const running = useRef(false)
  useEffect(() => {
    if (!focusReceipt.current) return
    const receipt = document.getElementById(
      'seller-handover-' + focusReceipt.current,
    )
    if (!receipt) return
    focusReceipt.current = null
    receipt.focus({ preventScroll: true })
    receipt.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [handovers])
  useEffect(() => {
    if (failedTarget)
      document.getElementById(`${feedbackId}-${failedTarget}`)?.focus()
  }, [failedTarget, feedbackId])
  const pending = useRef(
    new Map<string, { id: string; payload: HandoverChange }>(),
  )
  const creation = outcomes.create
  const creationLocked =
    creation?.phase === 'busy' ||
    creation?.phase === 'uncertain' ||
    creation?.phase === 'stale'
  function outcome(target: string, value: Outcome) {
    setOutcomes((previous) => ({ ...previous, [target]: value }))
  }
  function feedback(target: string) {
    const state = outcomes[target]
    if (!state?.error && !(target === 'create' && state?.phase === 'confirmed'))
      return null
    return (
      <p
        id={`${feedbackId}-${target}`}
        role={state.error ? 'alert' : 'status'}
        tabIndex={-1}
      >
        {state.error ?? d.saved}
      </p>
    )
  }
  async function submit(payload: HandoverChange) {
    if (running.current) return
    const target =
      payload.action === 'createHandover' ? 'create' : payload.handoverId
    if (
      outcomes[target]?.phase === 'stale' ||
      (target !== 'create' && outcomes[target]?.phase === 'confirmed')
    )
      return
    // Each action owns its envelope, including separate cancellations. A later
    // click never relabels or changes another unresolved command.
    let request = pending.current.get(target)
    if (!request) {
      request = { id: crypto.randomUUID(), payload }
      pending.current.set(target, request)
    }
    running.current = true
    setBusy(true)
    setFailedTarget(null)
    outcome(target, { phase: 'busy' })
    try {
      const r = await fetch('/api/seller/handovers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sellerId,
          requestId: request.id,
          ...request.payload,
        }),
      })
      const result = await r.json().catch(() => null)
      if (!r.ok) {
        const answered = r.status >= 400 && r.status < 500
        if (answered && result?.error === 'INVALID_INPUT') {
          pending.current.delete(target)
          outcome(target, { phase: 'idle', error: recovery.invalid })
        } else if (answered && staleErrors.has(result?.error)) {
          outcome(target, { phase: 'stale', error: d.handoverError })
        } else {
          outcome(target, { phase: 'uncertain', error: d.handoverError })
        }
        setFailedTarget(target)
        return
      }
      if (result?.ok !== true || result?.id !== request.id)
        throw new Error('Unconfirmed handover response')
      if (request.payload.action === 'createHandover') {
        focusReceipt.current = request.id
        form.current?.reset()
      } else focusReceipt.current = request.payload.handoverId
      pending.current.delete(target)
      outcome(target, { phase: 'confirmed' })
      router.refresh()
    } catch {
      outcome(target, { phase: 'uncertain', error: d.handoverError })
      setFailedTarget(target)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section
      id="portal-handovers"
      className="card intake-form"
      aria-label={d.handovers}
      tabIndex={-1}
    >
      <h2>{d.handovers}</h2>
      <p>{d.handoverIntro}</p>
      {handovers.enabled || creationLocked ? (
        <form
          ref={form}
          onChange={() => {
            if (!creationLocked && !busy && creation?.phase === 'confirmed')
              outcome('create', { phase: 'idle' })
          }}
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            void submit({
              action: 'createHandover',
              kind: String(f.get('kind')),
              estimatedItems: Number(f.get('estimatedItems') || 0),
              note: String(f.get('note') ?? ''),
            })
          }}
        >
          <fieldset className="intake-fields" disabled={busy || creationLocked}>
            <div className="field">
              <label htmlFor="handover-kind">{d.handoverKind}</label>
              <select id="handover-kind" name="kind" defaultValue="bag">
                <option value="bag">{d.handoverKinds.bag}</option>
                <option value="box">{d.handoverKinds.box}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="handover-items">{d.estimatedItems}</label>
              <input
                id="handover-items"
                name="estimatedItems"
                type="number"
                min={0}
                max={500}
                defaultValue={5}
              />
            </div>
            <div className="field">
              <label htmlFor="handover-note">{d.handoverNote}</label>
              <input id="handover-note" name="note" maxLength={500} />
            </div>
          </fieldset>
          {feedback('create')}
          {!handovers.enabled && <p>{d.handoverDisabled}</p>}
          <Button type="submit" disabled={busy || creation?.phase === 'stale'}>
            {creation?.phase === 'busy'
              ? recovery.busy
              : creation?.phase === 'uncertain'
                ? recovery.retry
                : d.announce}
          </Button>
          {creation?.phase === 'stale' && (
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
        <p>{d.handoverDisabled}</p>
      )}
      {handovers.handovers.length === 0 && <p>{d.none}</p>}
      {handovers.handovers.map((h) => (
        <div
          key={h.id}
          id={'seller-handover-' + h.id}
          tabIndex={-1}
          style={{ scrollMarginTop: '1rem' }}
          className="intake-notice"
        >
          <div className="seller-handover-heading">
            <strong style={{ fontSize: '1.4em' }}>{h.reference}</strong>
            <time dateTime={h.createdAt}>
              {new Date(h.createdAt).toLocaleDateString(intlLocale(locale), {
                timeZone: 'Europe/Stockholm',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </time>
          </div>
          <p>
            {d.handoverKinds[h.kind]} ·{' '}
            {d.handoverItemCount.replace('{count}', String(h.estimatedItems))} ·{' '}
            {d.handoverStatuses[h.status]}
            {h.bagReference
              ? ` · ${d.handoverReceipt.replace('{reference}', h.bagReference)}`
              : ''}
            {h.note ? ` · ${h.note}` : ''}
          </p>
          {h.status === 'open' && (
            <>
              <p>{d.showReference}</p>
              <HandoverCode
                tenantId={tenantId}
                sellerId={sellerId}
                reference={h.reference}
                d={d}
              />
            </>
          )}
          {feedback(h.id)}
          {(h.status === 'open' || outcomes[h.id]?.phase === 'uncertain') && (
            <Button
              type="button"
              variant="secondary"
              disabled={
                busy ||
                outcomes[h.id]?.phase === 'stale' ||
                outcomes[h.id]?.phase === 'confirmed'
              }
              aria-label={
                outcomes[h.id]?.phase === 'uncertain'
                  ? `${recovery.retry}: ${h.reference}`
                  : undefined
              }
              onClick={() =>
                void submit({ action: 'cancelHandover', handoverId: h.id })
              }
            >
              {outcomes[h.id]?.phase === 'busy'
                ? recovery.busy
                : outcomes[h.id]?.phase === 'uncertain'
                  ? recovery.retry
                  : d.cancelHandover}
            </Button>
          )}
          {outcomes[h.id]?.phase === 'stale' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {recovery.reload}
            </Button>
          )}
        </div>
      ))}
    </section>
  )
}
