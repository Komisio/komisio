'use client'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useBusyState } from '@/components/platform/work-activity'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type {
  SellerPrivacyPreview,
  eraseSellerContactCommand,
} from '@/lib/engine/seller-privacy'
import type { z } from 'zod'

export function SellerPrivacy({
  tenantId,
  sellerId,
  preview,
  d,
}: {
  tenantId: string
  sellerId: string
  preview: SellerPrivacyPreview
  d: Dictionary['sellerPrivacy']
}) {
  const router = useRouter()
  const [busy, setBusy] = useBusyState(false)
  const running = useRef(false)
  const pending = useRef<z.infer<typeof eraseSellerContactCommand> | null>(null)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [done, setDone] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [stale, setStale] = useState(false)
  const [confirming, setConfirming] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (running.current || stale || done) return
    if (!preview.closedAt && !confirming && !pending.current) {
      setConfirming(true)
      return
    }
    const data = new FormData(event.currentTarget)
    pending.current ??= {
      action: preview.closedAt ? 'review' : 'erase',
      tenantId,
      sellerId,
      requestId: crypto.randomUUID(),
      revision: preview.revision,
      reason: String(data.get('reason') ?? ''),
      reviewOn: String(data.get('reviewOn') ?? ''),
      confirmed: true,
    }
    running.current = true
    setSubmitted(true)
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/sellers/${sellerId}/privacy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      const result = await response.json()
      if (response.ok && result.id === pending.current.requestId) {
        setDone(true)
        setUncertain(false)
        router.refresh()
        return
      }
      if (response.status >= 400 && response.status < 500) {
        setStale(true)
        setUncertain(false)
        setError(d.changed)
      } else {
        setUncertain(true)
        setError(d.uncertain)
      }
    } catch {
      setUncertain(true)
      setError(d.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const closed = !!preview.closedAt || done
  const blockers = Object.entries(preview.blockers).filter(
    ([, v]) => v !== 0 && v !== false,
  )
  return (
    <div className="grid gap-6">
      {closed && (
        <div
          role="status"
          className="rounded-xl border border-[var(--line)] p-5"
        >
          <strong>{d.closed}</strong>
          <p>{d.remaining}</p>
        </div>
      )}
      {!closed && blockers.length > 0 && (
        <section
          className="rounded-xl border border-[var(--line)] p-5"
          aria-labelledby="privacy-blockers"
        >
          <h2 id="privacy-blockers">{d.blocked}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {blockers.map(([key, value]) => (
              <li key={key}>
                {d.blockers[key as keyof typeof d.blockers]}
                {typeof value === 'number' ? ` (${value})` : ''}
              </li>
            ))}
          </ul>
          <a className="text-link" href={`/intake/sellers/${sellerId}`}>
            {d.resolve}
          </a>
        </section>
      )}
      <section
        className="grid gap-4 rounded-xl border border-[var(--line)] p-5 sm:p-6"
        aria-labelledby="privacy-scope"
      >
        <h2 id="privacy-scope">{closed ? d.retain : d.scope}</h2>
        <div className={`grid gap-6 ${closed ? '' : 'sm:grid-cols-2'}`}>
          {!closed && (
            <div>
              <h3>{d.remove}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>{d.contact}</li>
                <li>
                  {d.bankRemovable} ({preview.counts.bankRemovable})
                </li>
                <li>
                  {d.profiles} ({preview.counts.profiles})
                </li>
                <li>
                  {d.messages} ({preview.counts.ordinaryMessages})
                </li>
                <li>
                  {d.reviewContacts} ({preview.counts.reviewContacts})
                </li>
                <li>{d.access}</li>
              </ul>
            </div>
          )}
          <div>
            {!closed && <h3>{d.retain}</h3>}
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                {d.accounting} (
                {preview.counts.statements + preview.counts.ledger})
              </li>
              <li>
                {d.agreements} ({preview.counts.agreements})
              </li>
              <li>
                {d.financialMessages} ({preview.counts.financialMessages})
              </li>
              <li>
                {d.bankRetained} ({preview.counts.bankRetained})
              </li>
              <li>
                {d.sourceEvidence} (
                {preview.counts.receptions + preview.counts.submissions})
              </li>
            </ul>
          </div>
        </div>
        <p>{d.sharedAccount}</p>
        <details>
          <summary>{d.otherCopies}</summary>
          <p className="mt-3">{d.otherCopiesHint}</p>
          <p className="mt-3">{d.retentionHint}</p>
        </details>
      </section>
      {!done && (
        <form
          onSubmit={submit}
          className="grid gap-4 rounded-xl border border-[var(--line)] p-5 sm:p-6"
        >
          <h2>{closed ? d.followUp : d.review}</h2>
          <fieldset
            disabled={
              busy || submitted || stale || (!preview.canErase && !closed)
            }
            className="grid gap-4"
          >
            <div className="field">
              <label htmlFor="privacy-reason">{d.reason}</label>
              <textarea
                id="privacy-reason"
                name="reason"
                minLength={10}
                maxLength={1000}
                required
                rows={3}
                aria-describedby="privacy-note"
                onChange={() => setConfirming(false)}
              />
              <p id="privacy-note">{d.reasonHint}</p>
            </div>
            <div className="field max-w-xs">
              <label htmlFor="privacy-review-on">{d.reviewOn}</label>
              <input
                id="privacy-review-on"
                name="reviewOn"
                type="date"
                required
                onChange={() => setConfirming(false)}
              />
            </div>
            <label className="intake-confirm">
              <input
                type="checkbox"
                required
                onChange={() => setConfirming(false)}
              />
              {d.confirm}
            </label>
          </fieldset>
          {confirming && !uncertain && <p role="alert">{d.irreversible}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-3">
            {!stale && (
              <Button
                type="submit"
                variant={confirming && !closed ? 'danger' : 'primary'}
                disabled={busy || (!preview.canErase && !closed)}
              >
                {busy
                  ? d.working
                  : uncertain
                    ? d.retry
                    : closed
                      ? d.saveReview
                      : confirming
                        ? d.erase
                        : d.continue}
              </Button>
            )}
            {confirming && !submitted && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming(false)}
              >
                {d.cancel}
              </Button>
            )}
            {stale && (
              <Button type="button" onClick={() => window.location.reload()}>
                {d.reload}
              </Button>
            )}
          </div>
        </form>
      )}
      {done && preview.closedAt && <p role="status">{d.reviewSaved}</p>}
      {preview.history.length > 0 && (
        <section className="grid gap-3" aria-labelledby="privacy-history">
          <h2 id="privacy-history">{d.history}</h2>
          {preview.history.map((event) => (
            <article
              className="rounded-xl border border-[var(--line)] p-5"
              key={event.id}
            >
              <p>
                {event.kind === 'contact_erased' ? d.closed : d.reviewSaved} ·{' '}
                <time dateTime={event.created_at}>
                  {event.created_at.slice(0, 10)}
                </time>
              </p>
              <p className="whitespace-pre-wrap">{event.retention_reason}</p>
              <p>
                {d.reviewOn}:{' '}
                <time dateTime={event.review_on}>{event.review_on}</time>
              </p>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
