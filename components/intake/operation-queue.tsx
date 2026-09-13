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
  currency,
  d,
}: {
  tenantId: string
  operations: PendingOperation[]
  canDecide: boolean
  locale: string
  reviewContext?: OperationReviewContext
  currency: string
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
                      {o.payload.suggestions.price.amount} ${currency} ·{' '}
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
                {d.proposedPrice}: {(o.payload.priceOre / 100).toFixed(2)} $
                {currency}
              </p>
            </>
          ) : o.kind === 'recordReturn' ? (
            <p>
              {d.saleLine}: {o.payload.saleLineId} · {d.refund}:{' '}
              {(o.payload.refundOre / 100).toFixed(2)} ${currency} ·{' '}
              {o.payload.reason}
            </p>
          ) : o.kind === 'adjustLedger' ? (
            <p>
              <Link
                className="text-link"
                href={`/intake/sellers/${o.payload.sellerId}`}
              >
                {d.seller}
              </Link>{' '}
              · {d.adjustment}: {(o.payload.amountOre / 100).toFixed(2)} $
              {currency} · {o.payload.reason}
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
          ) : o.kind === 'bulkItemUpdate' ? (
            <p>
              {d.bulkActions[o.payload.action]} · {d.batchItems}:{' '}
              {o.payload.items.length}
              {o.payload.action === 'setPrice'
                ? ` · ${o.payload.reason}`
                : ` · ${d.endActions[o.payload.endAction]}${o.payload.note ? ` · ${o.payload.note}` : ''}`}
            </p>
          ) : o.kind === 'approvePayout' || o.kind === 'markPayoutPaid' ? (
            <p>
              <Link className="text-link" href="/intake/payouts">
                {d.payout}
              </Link>{' '}
              · {o.payload.payoutId.slice(0, 8).toUpperCase()}
              {o.kind === 'markPayoutPaid'
                ? ` · ${d.paymentReference}: ${o.payload.reference}`
                : ''}
              {o.payload.reason ? ` · ${o.payload.reason}` : ''}
            </p>
          ) : o.kind === 'sendMessage' ? (
            <>
              <p>
                <Link
                  className="text-link"
                  href={`/intake/sellers/${o.payload.sellerId}`}
                >
                  {d.seller}
                </Link>{' '}
                · {o.payload.locale}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{o.payload.freeText}</p>
              <p>
                <small>{d.messageTemplateNote}</small>
              </p>
            </>
          ) : o.kind === 'recordZettlePurchase' ? (
            <p>
              <Link
                className="text-link"
                href={`/intake/integrations/${o.payload.importId}`}
              >
                {d.zettleReceipt}
              </Link>{' '}
              · {d.draftVersion} {o.payload.mappingRevision}
            </p>
          ) : o.kind === 'exportDayClose' ? (
            <p>
              <Link className="text-link" href="/intake/accounting">
                {d.dayClose}
              </Link>{' '}
              · {o.payload.dayCloseId.slice(0, 8).toUpperCase()}
            </p>
          ) : o.kind === 'settlePayouts' ? (
            <p>
              <Link className="text-link" href="/intake/payouts">
                {d.kinds.settlePayouts}
              </Link>{' '}
              · {o.payload.sellers.length} ·{' '}
              {(
                o.payload.sellers.reduce((sum, s) => sum + s.amountOre, 0) / 100
              ).toFixed(2)}{' '}
              {currency} · {o.payload.reason}
            </p>
          ) : o.kind === 'updateStoreProfile' ? (
            <div>
              <p>
                <Link className="text-link" href="/settings">
                  {d.kinds.updateStoreProfile}
                </Link>{' '}
                · {o.payload.profile.address.city || '–'} ·{' '}
                {o.payload.profile.openingHours.length} {d.openDays}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {o.payload.profile.concept}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {o.payload.profile.accepts}
              </p>
            </div>
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
          {reviewContext?.kind === 'zettle' && (
            <section aria-label={d.zettleReceipt}>
              <h3>{d.zettleReceipt}</h3>
              <p>
                {reviewContext.receipt.external_id} ·{' '}
                {reviewContext.receipt.occurred_at}
              </p>
              <ul>
                {reviewContext.receipt.rows.map((r) => (
                  <li key={r.lineNo}>
                    {r.description} ·{' '}
                    {r.itemId ? (
                      <Link
                        className="text-link"
                        href={`/intake/items/${r.itemId}`}
                      >
                        {r.itemId}
                      </Link>
                    ) : (
                      '—'
                    )}{' '}
                    · {(r.priceOre / 100).toFixed(2)}{' '}
                    {reviewContext.receipt.currency}
                  </li>
                ))}
              </ul>
              <p>
                {(reviewContext.receipt.amount_ore / 100).toFixed(2)}{' '}
                {reviewContext.receipt.currency}
              </p>
            </section>
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
          {reviewContext?.kind === 'bulk' && (
            <section aria-label={d.bulkPreview}>
              <h3>{d.bulkPreview}</h3>
              <p>{d.engineNotice}</p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>{d.item}</th>
                      <th>{d.currentPrice}</th>
                      <th>
                        {reviewContext.action === 'setPrice'
                          ? d.newPrice
                          : d.endActionHeading}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewContext.rows.map((r) => (
                      <tr key={r.itemId}>
                        <td>
                          <Link
                            className="text-link"
                            href={`/intake/items/${r.itemId}`}
                          >
                            {r.itemId.slice(0, 8).toUpperCase()}
                          </Link>
                          {!r.exists ? ` · ${d.missingItem}` : ''}
                        </td>
                        <td>
                          {r.currentPriceOre === null
                            ? '–'
                            : `${(r.currentPriceOre / 100).toFixed(2)} ${currency}`}
                        </td>
                        <td>
                          {r.newPriceOre !== null
                            ? `${(r.newPriceOre / 100).toFixed(2)} ${currency}`
                            : o.kind === 'bulkItemUpdate' &&
                                o.payload.action === 'endPeriod'
                              ? d.endActions[o.payload.endAction]
                              : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!o.outcome && reviewContext.stale && (
                <p role="alert">{d.staleEngine}</p>
              )}
            </section>
          )}
          {reviewContext?.kind === 'settlement' && (
            <section aria-label={d.settlementPreview}>
              <h3>{d.settlementPreview}</h3>
              <p>{d.settlementNotice}</p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>{d.seller}</th>
                      <th>{d.availableNow}</th>
                      <th>{d.proposedAmount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewContext.rows.map((r) => (
                      <tr key={r.sellerId}>
                        <td>
                          <Link
                            className="text-link"
                            href={`/intake/sellers/${r.sellerId}`}
                          >
                            {r.name ?? r.sellerId.slice(0, 8).toUpperCase()}
                          </Link>
                          {r.name === null ? ` · ${d.missingSeller}` : ''}
                          {r.openPayout ? ` · ${d.openPayout}` : ''}
                        </td>
                        <td>
                          {r.availableOre === null
                            ? '–'
                            : `${(r.availableOre / 100).toFixed(2)} ${currency}`}
                        </td>
                        <td>
                          {(r.amountOre / 100).toFixed(2)} ${currency}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>{d.total}</td>
                      <td></td>
                      <td>
                        {(reviewContext.totalOre / 100).toFixed(2)} ${currency}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
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
