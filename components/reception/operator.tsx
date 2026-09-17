'use client'
import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type {
  ReceptionSession,
  ReceptionSuggestions,
} from '@/lib/engine/reception'
import {
  exactPrice,
  manualReceptionSources,
} from '@/lib/engine/manual-reception'
import {
  receptionReviewFields,
  reviewReceptionFacts,
  type ReceptionReviewField,
} from '@/lib/engine/reception-fact-review'
import { Button } from '@/components/ui/button'
type D = Dictionary['reception']
function useWrite(d: D) {
  const [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(false)
  const pending = useRef<{ path: string; body: object } | null>(null),
    running = useRef(false)
  const router = useRouter()
  async function run(path: string, body: object) {
    if (running.current || reload) return null
    pending.current ??= { path, body }
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    try {
      const response = await fetch(pending.current.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current.body),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(d.failed)
        setReload(true)
        return null
      }
      pending.current = null
      setLocked(false)
      return result as { id: string; path?: string | null }
    } catch {
      setError(d.retry)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy, locked, error, reload, router }
}
function Failure({ action, d }: { action: ReturnType<typeof useWrite>; d: D }) {
  return (
    <>
      {action.error && <p role="alert">{action.error}</p>}
      {action.reload && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {d.reload}
        </Button>
      )}
    </>
  )
}
export function StartReception({
  tenantId,
  sellers,
  d,
}: {
  tenantId: string
  sellers: { id: string; name: string; email: string; phone: string }[]
  d: D
}) {
  const [seller, setSeller] = useState(sellers[0]?.id ?? '')
  const action = useWrite(d)
  return (
    <form
      className="intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const result = await action.run('/api/intake', {
          action: 'createReception',
          tenantId,
          requestId: crypto.randomUUID(),
          sellerId: seller,
        })
        if (result) {
          action.router.push(`/intake/reception/${result.id}`)
          action.router.refresh()
        }
      }}
    >
      <div className="field">
        <label htmlFor="reception-seller">{d.seller}</label>
        <select
          id="reception-seller"
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          disabled={action.locked}
          required
        >
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.email || s.phone}
            </option>
          ))}
        </select>
      </div>
      <Button disabled={!seller || action.busy || action.reload}>
        {action.locked ? d.retryButton : d.start}
      </Button>
      <Failure action={action} d={d} />
    </form>
  )
}
export function ReceptionObservation({
  tenantId,
  sessionId,
  revision,
  sources,
  initial,
  d,
}: {
  tenantId: string
  sessionId: string
  revision: number
  sources: ReceptionSession['sources']
  initial: {
    description: string
    amount: string
    reference: string
    rationale: string
  } | null
  d: D
}) {
  const action = useWrite(d),
    [invalid, setInvalid] = useState('')
  return (
    <form
      className="intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setInvalid('')
        if (action.locked) {
          const result = await action.run('/api/intake', {})
          if (result) action.router.refresh()
          return
        }
        const form = new FormData(e.currentTarget)
        let next: ReceptionSession['sources']
        try {
          next = manualReceptionSources(
            sources,
            {
              description: form.get('description'),
              amount: exactPrice(String(form.get('amount'))),
              reference: form.get('reference'),
              rationale: form.get('rationale'),
            },
            crypto.randomUUID(),
            crypto.randomUUID(),
          )
        } catch {
          setInvalid(d.invalid)
          return
        }
        const result = await action.run('/api/intake', {
          action: 'saveReceptionSources',
          tenantId,
          requestId: crypto.randomUUID(),
          sessionId,
          expectedRevision: revision,
          sources: next,
        })
        if (result) action.router.refresh()
      }}
    >
      <fieldset disabled={action.locked} className="reception-fields">
        <div className="field">
          <label htmlFor="garment-description">{d.description}</label>
          <textarea
            id="garment-description"
            name="description"
            maxLength={1000}
            required
            defaultValue={initial?.description ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="garment-price">{d.price}</label>
          <input
            id="garment-price"
            name="amount"
            inputMode="decimal"
            required
            maxLength={9}
            defaultValue={initial?.amount ?? ''}
          />
          <small>{d.priceHelp}</small>
        </div>
        <div className="field">
          <label htmlFor="garment-reference">{d.reference}</label>
          <input
            id="garment-reference"
            name="reference"
            maxLength={200}
            required
            defaultValue={initial?.reference ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="garment-rationale">{d.rationale}</label>
          <textarea
            id="garment-rationale"
            name="rationale"
            maxLength={500}
            required
            defaultValue={initial?.rationale ?? ''}
          />
        </div>
      </fieldset>
      <p>{d.sourceNotice}</p>
      <Button disabled={action.busy || action.reload}>
        {action.locked ? d.retryButton : d.saveSources}
      </Button>
      {invalid && <p role="alert">{invalid}</p>}
      <Failure action={action} d={d} />
    </form>
  )
}
export function PublishReview({
  tenantId,
  sessionId,
  revision,
  previousId,
  agreementId,
  suggestions,
  requireFieldReview = false,
  d,
}: {
  tenantId: string
  sessionId: string
  revision: number
  previousId: string | null
  agreementId: string | null
  suggestions: ReceptionSuggestions
  requireFieldReview?: boolean
  d: D
}) {
  const action = useWrite(d),
    [confirmed, setConfirmed] = useState(false),
    [selected, setSelected] = useState<ReceptionReviewField[]>([])
  const review = requireFieldReview
    ? reviewReceptionFacts(suggestions, selected)
    : { suggestions, complete: true }
  const fields = requireFieldReview ? receptionReviewFields(suggestions) : []
  return (
    <div>
      {fields.map((field) => (
        <label key={field} className="intake-confirm">
          <input
            type="checkbox"
            name={`review-${field}`}
            checked={selected.includes(field)}
            disabled={action.locked}
            onChange={(e) => {
              setSelected(
                e.target.checked
                  ? [...selected, field]
                  : selected.filter((f) => f !== field),
              )
              setConfirmed(false)
            }}
          />
          {field === 'price'
            ? d.confirmPrice
            : `${d.confirmFact}: ${(d.aiFields as Record<string, string | undefined>)[field] ?? field}`}
        </label>
      ))}
      <label className="intake-confirm">
        <input
          type="checkbox"
          name="review-final"
          checked={confirmed}
          disabled={action.locked}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {d.confirm}
      </label>
      <p>{d.expiry}</p>
      <Button
        disabled={
          !confirmed || !review.complete || action.busy || action.reload
        }
        onClick={async () => {
          if (!confirmed || !review.complete) return
          const result = await action.run('/api/intake', {
            action: 'publishReceptionReview',
            tenantId,
            requestId: crypto.randomUUID(),
            sessionId,
            sourceRevision: revision,
            previousReviewId: previousId,
            agreementId,
            suggestions: review.suggestions,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          })
          if (result) action.router.refresh()
        }}
      >
        {action.locked ? d.retryButton : d.publish}
      </Button>
      <Failure action={action} d={d} />
    </div>
  )
}
export function ReviewAccess({
  tenantId,
  reviewId,
  access,
  available,
  email,
  d,
}: {
  tenantId: string
  reviewId: string
  access: { id: string; enabled: boolean } | null
  available: boolean
  email: string
  d: D
}) {
  const action = useWrite(d),
    [path, setPath] = useState<string | null>(null),
    [copied, setCopied] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  async function change(enabled: boolean) {
    const result = await action.run('/api/reception/access', {
      tenantId,
      requestId: crypto.randomUUID(),
      reviewId,
      previousId: access?.id ?? null,
      enabled,
    })
    if (result) {
      setPath(result.path ?? null)
      setCopied(false)
      startRefresh(() => action.router.refresh())
    }
  }
  return (
    <div>
      <p>
        {d.recipient}: <strong>{email || d.noEmail}</strong>
      </p>
      <p>{d.linkNotice}</p>
      <div className="row wrap">
        <Button
          disabled={
            !available || !email || action.busy || action.reload || refreshing
          }
          onClick={() => change(true)}
        >
          {access?.enabled ? d.replaceLink : d.issueLink}
        </Button>
        {access?.enabled && (
          <Button
            variant="secondary"
            disabled={action.busy || action.reload || refreshing}
            onClick={() => change(false)}
          >
            {d.revokeLink}
          </Button>
        )}
      </div>
      {path && available && (
        <div className="field">
          <label htmlFor="seller-review-link">{d.link}</label>
          <input
            id="seller-review-link"
            readOnly
            value={
              typeof window === 'undefined'
                ? path
                : window.location.origin + path
            }
          />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  window.location.origin + path,
                )
                setCopied(true)
              } catch {
                document
                  .querySelector<HTMLInputElement>('#seller-review-link')
                  ?.select()
              }
            }}
          >
            {copied ? d.copied : d.copy}
          </Button>
        </div>
      )}
      <Failure action={action} d={d} />
    </div>
  )
}
