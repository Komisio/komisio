'use client'
import Link from 'next/link'
import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type {
  prepareReceptionBatch,
  BatchCandidate,
} from '@/lib/assistance/reception-batch'
import type { ReceptionSession } from '@/lib/engine/reception'
import {
  receptionReviewFields,
  reviewReceptionFacts,
  type ReceptionReviewField,
} from '@/lib/engine/reception-fact-review'
import { Button } from '@/components/ui/button'

type Props = {
  batch: ReturnType<typeof prepareReceptionBatch>
  sources: ReceptionSession['sources']
  agreementId: string | null
  agreementReady: boolean
  d: Dictionary['reception']
}
export function BatchReview(props: Props) {
  return (
    <div className="intake-form">
      {props.batch.questions.length > 0 && (
        <>
          <h3>{props.d.aiQuestions}</h3>
          <ul>
            {props.batch.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}
      {props.batch.candidates.map((candidate, row) => (
        <BatchRow key={row} {...props} candidate={candidate} row={row} />
      ))}
    </div>
  )
}
function BatchRow({
  batch,
  sources,
  agreementId,
  agreementReady,
  candidate,
  row,
  d,
}: Props & { candidate: BatchCandidate; row: number }) {
  const [selected, setSelected] = useState<ReceptionReviewField[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [dismissed, setDismissed] = useState(false),
    [result, setResult] = useState<{
      sessionId: string
      operationId: string
    } | null>(null)
  const [locked, setLocked] = useState(false)
  const request = useRef<object | null>(null),
    running = useRef(false)
  const fields = receptionReviewFields(candidate.suggestions),
    review = reviewReceptionFacts(candidate.suggestions, selected)
  return (
    <fieldset className="card intake-form">
      <legend>
        {d.batch.garment} {row + 1}
      </legend>
      {dismissed ? (
        <>
          <p>{d.batch.dismissed}</p>
          <Button onClick={() => setDismissed(false)}>{d.batch.restore}</Button>
        </>
      ) : (
        <>
          {Object.entries(candidate.suggestions.metadata).map(
            ([name, fact]) =>
              fact && (
                <div key={name}>
                  <strong>{d.aiFields[name as keyof typeof d.aiFields]}</strong>
                  <p>{fact.value}</p>
                  <small>{d.aiUnverified}</small>
                  <ul>
                    {fact.sourceIds.map((id) => (
                      <li key={id}>
                        {sources.find((s) => s.id === id)?.observation ||
                          d.photoAlt}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
          )}
          <p>
            {d.price}:{' '}
            {candidate.suggestions.price
              ? `${candidate.suggestions.price.amount} ${candidate.suggestions.price.currency}`
              : d.aiUnknown}
          </p>
          <p>{candidate.suggestions.price?.rationale}</p>
          <details>
            <summary>{d.aiSources}</summary>
            {candidate.sourceIds.map((id) => {
              const source = sources.find((s) => s.id === id)
              return (
                <div key={id}>
                  {source?.kind === 'photo' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/reception/${batch.sessionId}/photo?photo=${id}`}
                      alt={d.photoAlt}
                      width={240}
                    />
                  ) : (
                    <p>{source?.reference}</p>
                  )}
                  <p>{source?.observation}</p>
                </div>
              )
            })}
          </details>
          {candidate.suggestions.questions.length > 0 && (
            <ul>
              {candidate.suggestions.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          {result ? (
            <div className="intake-form">
              <p role="status">{d.batch.staged}</p>
              <Link
                className="text-link"
                href={`/intake/operations/${result.operationId}`}
              >
                {d.batch.openOperation}
              </Link>
              <Link
                className="text-link"
                href={`/intake/reception/${result.sessionId}`}
              >
                {d.open}
              </Link>
            </div>
          ) : (
            <>
              {fields.map((field) => (
                <label className="intake-confirm" key={field}>
                  <input
                    type="checkbox"
                    disabled={busy || locked}
                    checked={selected.includes(field)}
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
                    : `${d.confirmFact}: ${d.aiFields[field]}`}
                </label>
              ))}
              <label className="intake-confirm">
                <input
                  type="checkbox"
                  disabled={busy || locked}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {d.batch.confirm}
              </label>
              {(!review.complete || !agreementReady) && <p>{d.aiIncomplete}</p>}
              <Button
                disabled={
                  busy || !review.complete || !confirmed || !agreementReady
                }
                onClick={async () => {
                  if (running.current) return
                  running.current = true
                  setBusy(true)
                  setFailed(false)
                  setLocked(true)
                  request.current ??= {
                    tenantId: batch.tenantId,
                    sessionId: batch.sessionId,
                    batchId: batch.batchId,
                    revision: batch.baseRevision,
                    row,
                    candidate,
                    reviewedFields: selected,
                    confirmed: true,
                    agreementId,
                    expiresAt: new Date(Date.now() + 86400000).toISOString(),
                  }
                  try {
                    const response = await fetch('/api/reception/batch', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(request.current),
                    })
                    const value = await response.json()
                    if (
                      !response.ok ||
                      typeof value.sessionId !== 'string' ||
                      typeof value.operationId !== 'string'
                    )
                      throw new Error('failed')
                    setResult(value)
                  } catch {
                    setFailed(true)
                  } finally {
                    running.current = false
                    setBusy(false)
                  }
                }}
              >
                {failed ? d.retryButton : d.batch.stage}
              </Button>
              {!locked && (
                <Button onClick={() => setDismissed(true)}>
                  {d.batch.dismiss}
                </Button>
              )}
              {failed && <p role="alert">{d.batch.failed}</p>}
            </>
          )}
        </>
      )}
    </fieldset>
  )
}
