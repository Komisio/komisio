'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { ReceptionComparison } from './reception-comparison'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { PendingOperation } from '@/lib/engine/operations'
import type { OperationReviewContext } from '@/lib/engine/operation-review'
import {
  receptionReviewFields,
  type ReceptionReviewField,
} from '@/lib/engine/reception-fact-review'
import { Button } from '@/components/ui/button'
type D = Dictionary['operations']

function Decision({
  tenantId,
  operation,
  canApprove,
  fieldsToConfirm = [],
  d,
}: {
  tenantId: string
  operation: PendingOperation
  canApprove: boolean
  fieldsToConfirm?: ReceptionReviewField[]
  d: D
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [attempted, setAttempted] = useState<'approve' | 'reject' | null>(null)
  // Freeze the whole envelope: an unknown response may already have committed.
  const pending = useRef<{
    tenantId: string
    operationId: string
    requestId: string
    decision: 'approve' | 'reject'
    reason: string
  } | null>(null)
  const running = useRef(false)
  async function send() {
    if (running.current || reload || !pending.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(
          result.error === 'OPERATION_DECIDED'
            ? d.alreadyDecided
            : result.error === 'OPERATION_EXPIRED'
              ? d.expired
              : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
                ? d.denied
                : d.failed,
        )
        setReload(true)
        return
      }
      router.refresh()
    } catch {
      setError(d.retry)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  function decide(decision: 'approve' | 'reject', reason: string) {
    if (pending.current || reload || (decision === 'approve' && !canApprove))
      return
    pending.current = {
      tenantId,
      operationId: operation.id,
      requestId: crypto.randomUUID(),
      decision,
      reason,
    }
    setAttempted(decision)
    void send()
  }
  return (
    <form
      className="intake-fields"
      onSubmit={(event) => {
        event.preventDefault()
        if (pending.current) return
        const reason = String(
          new FormData(event.currentTarget).get('reason') ?? '',
        )
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const decision =
          submitter?.getAttribute('value') === 'reject' ? 'reject' : 'approve'
        if (decision === 'approve' && !event.currentTarget.reportValidity())
          return
        decide(decision, reason)
      }}
    >
      <div className="field">
        <label htmlFor={`reason-${operation.id}`}>{d.reason}</label>
        <input
          id={`reason-${operation.id}`}
          name="reason"
          maxLength={500}
          disabled={!!attempted || reload}
        />
      </div>
      {fieldsToConfirm.map((field) => (
        <label className="intake-confirm" key={field}>
          <input
            type="checkbox"
            name={`field-${field}`}
            required
            disabled={!!attempted || reload}
            onChange={() => setConfirmed(false)}
          />
          {field === 'price'
            ? d.confirmPrice
            : `${d.confirmField}: ${d.fields[field]}`}
        </label>
      ))}
      <label className="intake-confirm">
        <input
          type="checkbox"
          name="checked"
          required
          checked={confirmed}
          disabled={!!attempted || reload}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {operation.kind === 'saveInspectionDraft'
          ? d.confirmInspection
          : operation.kind === 'acceptItem'
            ? d.confirmAcceptance
            : d.confirm}
      </label>
      {error && <p role="alert">{error}</p>}
      {reload ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {d.reload}
        </Button>
      ) : attempted ? (
        <div>
          <p>
            {d.lockedDecision}:{' '}
            {attempted === 'reject'
              ? d.reject
              : operation.kind === 'saveInspectionDraft'
                ? d.saveDraft
                : operation.kind === 'acceptItem'
                  ? d.acceptItem
                  : d.approve}
          </p>
          <Button type="button" disabled={busy} onClick={() => void send()}>
            {busy ? d.busy : d.retrySame}
          </Button>
        </div>
      ) : (
        <div className="row">
          <Button type="submit" value="approve" disabled={busy || !canApprove}>
            {busy
              ? d.busy
              : operation.kind === 'saveInspectionDraft'
                ? d.saveDraft
                : operation.kind === 'acceptItem'
                  ? d.acceptItem
                  : d.approve}
          </Button>
          <Button
            type="submit"
            value="reject"
            formNoValidate
            variant="secondary"
            disabled={busy}
          >
            {d.reject}
          </Button>
        </div>
      )}
    </form>
  )
}

export function OperationQueue({
  tenantId,
  operations,
  canDecide,
  locale,
  reviewContext,
  d,
}: {
  tenantId: string
  operations: PendingOperation[]
  canDecide: boolean
  locale: string
  reviewContext?: OperationReviewContext
  d: D
}) {
  const format = (value: string) =>
    new Date(value).toLocaleString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <ul className="intake-list">
      {operations.map((o) => (
        <li key={o.id} className="card intake-form">
          <span className="badge">{d.status[o.status]}</span>
          <h2>{d.kinds[o.kind]}</h2>
          <p>
            {d.proposedBy}: {o.actor_label} · {format(o.created_at)}
            <br />
            {d.riskLevel}: {d.risk[o.risk_level]} · {d.validUntil}:{' '}
            {format(o.expires_at)}
          </p>
          {o.kind === 'publishReceptionReview' ? (
            <>
              <p>
                <Link
                  className="text-link"
                  href={`/intake/reception/${o.payload.sessionId}`}
                >
                  {d.openReception}
                </Link>{' '}
                · {d.sourceRevision} {o.payload.sourceRevision}
              </p>
              <dl className="operation-facts">
                {Object.entries(o.payload.suggestions.metadata).map(
                  ([key, fact]) =>
                    fact ? (
                      <div key={key}>
                        <dt>{d.fields[key as keyof D['fields']]}</dt>
                        <dd>
                          {fact.value}
                          {reviewContext && (
                            <small> · {fact.sourceIds.join(', ')}</small>
                          )}
                        </dd>
                      </div>
                    ) : null,
                )}
                {o.payload.suggestions.price && (
                  <div>
                    <dt>{d.price}</dt>
                    <dd>
                      {o.payload.suggestions.price.amount} SEK ·{' '}
                      {o.payload.suggestions.price.rationale}
                      {reviewContext && (
                        <small>
                          {' '}
                          · {o.payload.suggestions.price.sourceIds.join(', ')}
                        </small>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          ) : o.kind === 'acceptItem' ? (
            <>
              <p>
                <Link
                  className="text-link"
                  href={
                    o.payload.originKind === 'reception_review'
                      ? `/intake/reception/${o.payload.originId}`
                      : o.payload.originKind === 'purchase'
                        ? '/intake/purchases'
                        : `/intake/bags?draft=${o.payload.originId}`
                  }
                >
                  {d.openOrigin}
                </Link>{' '}
                · {d.originKinds[o.payload.originKind]}
                {o.payload.originRevision !== null
                  ? ` · ${d.draftVersion} ${o.payload.originRevision}`
                  : ''}
              </p>
              <p>
                {d.proposedPrice}: {(o.payload.priceOre / 100).toFixed(2)} SEK
              </p>
            </>
          ) : o.kind === 'recordReturn' ? (
            <p>
              {d.saleLine}: {o.payload.saleLineId} · {d.refund}:{' '}
              {(o.payload.refundOre / 100).toFixed(2)} SEK · {o.payload.reason}
            </p>
          ) : o.kind === 'adjustLedger' ? (
            <p>
              <Link
                className="text-link"
                href={`/intake/sellers/${o.payload.sellerId}`}
              >
                {d.seller}
              </Link>{' '}
              · {d.adjustment}: {(o.payload.amountOre / 100).toFixed(2)} SEK ·{' '}
              {o.payload.reason}
            </p>
          ) : o.kind === 'applyMarkdownBatch' ? (
            <ul>
              {o.payload.items.map((i) => (
                <li key={i.itemId}>
                  <Link
                    className="text-link"
                    href={`/intake/items/${i.itemId}`}
                  >
                    {i.itemId.slice(0, 8).toUpperCase()}
                  </Link>{' '}
                  · {d.step} {i.step}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>
                <Link
                  className="text-link"
                  href={`/intake/bags/${o.payload.bagId}/inspect?draft=${o.payload.draftId}`}
                >
                  {d.openInspection}
                </Link>{' '}
                · {d.draftVersion} {o.payload.expectedRevision}
              </p>
              <p>{o.payload.fields.description}</p>
            </>
          )}
          {!reviewContext && (
            <Link className="text-link" href={`/intake/operations/${o.id}`}>
              {d.reviewProposal}
            </Link>
          )}
          {reviewContext?.kind === 'reception' && (
            <ReceptionComparison comparison={reviewContext.comparison} d={d} />
          )}
          {reviewContext?.kind === 'reception' && (
            <section aria-label={d.reviewContext}>
              <h3>{d.reviewContext}</h3>
              <p>{d.contextNotice}</p>
              {reviewContext.sources.map((s) => (
                <div key={s.id} className="intake-notice">
                  <strong>
                    {s.id} · {s.kind}
                  </strong>
                  <p>{s.observation}</p>
                  {s.reference ? <p>{s.reference}</p> : <p>{d.photoNotice}</p>}
                </div>
              ))}
              {reviewContext.terms && (
                <>
                  <h3>
                    {reviewContext.terms.title} · {reviewContext.terms.version}
                  </h3>
                  <p>{reviewContext.terms.id}</p>
                  <div
                    className="reception-terms"
                    lang={reviewContext.terms.language}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {reviewContext.terms.body}
                  </div>
                </>
              )}
              {!o.outcome && reviewContext.stale && (
                <p role="alert">{d.staleContext}</p>
              )}
            </section>
          )}
          {reviewContext?.kind === 'inspection' && (
            <section aria-label={d.inspectionChanges}>
              <h3>{d.inspectionChanges}</h3>
              {reviewContext.changes.map((change) => (
                <div className="intake-notice" key={change.field}>
                  <strong>{d.fields[change.field]}</strong>
                  <p>
                    {d.before}: {change.before || d.emptyField}
                  </p>
                  <p>
                    {d.after}: {change.after || d.emptyField}
                  </p>
                </div>
              ))}
              {!o.outcome && reviewContext.stale && (
                <p role="alert">{d.staleInspection}</p>
              )}
            </section>
          )}
          {reviewContext?.kind === 'acceptance' && (
            <section aria-label={d.acceptanceContext}>
              <h3>{d.acceptanceContext}</h3>
              <p>{d.acceptanceNotice}</p>
              {reviewContext.alreadyAccepted && !o.outcome && (
                <p role="alert">{d.alreadyAccepted}</p>
              )}
              {!o.outcome && reviewContext.stale && (
                <p role="alert">{d.staleAcceptance}</p>
              )}
            </section>
          )}
          {reviewContext?.kind === 'engine' && (
            <section aria-label={d.engineContext}>
              <h3>{d.engineContext}</h3>
              <p>{d.engineNotice}</p>
              {reviewContext.alreadyDone && !o.outcome && (
                <p role="alert">{d.alreadyDone}</p>
              )}
              {!o.outcome && reviewContext.stale && (
                <p role="alert">{d.staleEngine}</p>
              )}
            </section>
          )}
          {reviewContext && !o.outcome && canDecide && (
            <Decision
              tenantId={tenantId}
              operation={o}
              canApprove={reviewContext.canApprove}
              fieldsToConfirm={
                reviewContext.kind === 'inspection'
                  ? reviewContext.changes.map((c) => c.field)
                  : o.kind === 'publishReceptionReview'
                    ? receptionReviewFields(o.payload.suggestions)
                    : []
              }
              d={d}
            />
          )}
          {o.outcome && (
            <p>
              {d.decided}: {d.status[o.status]}
              {o.decided_at ? ` · ${format(o.decided_at)}` : ''}
              {o.reason ? ` · ${o.reason}` : ''}
              {o.outcome === 'failed' && o.error_code
                ? ` · ${o.error_code}`
                : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
