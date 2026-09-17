'use client'
import { useId, useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import {
  receptionProposal,
  type ReceptionSuggestions,
  type ReceptionSession,
} from '@/lib/engine/reception'
import { Button } from '@/components/ui/button'
import { PublishReview } from './operator'
import { prepareReceptionBatch } from '@/lib/assistance/reception-batch'
import { BatchReview } from './batch-review'

export function ReceptionAssistance({
  tenantId,
  sessionId,
  sellerId,
  revision,
  sources,
  available,
  terms,
  previousId,
  agreementRequired = true,
  d,
}: {
  tenantId: string
  sessionId: string
  sellerId: string
  revision: number
  sources: ReceptionSession['sources']
  available: boolean
  terms: {
    id: string
    title: string
    body: string
    language: string
    version: number
  } | null
  agreementRequired?: boolean
  previousId: string | null
  d: Dictionary['reception']
}) {
  const [candidate, setCandidate] = useState<ReceptionSuggestions | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempted, setAttempted] = useState(false)
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [batch, setBatch] = useState<ReturnType<
    typeof prepareReceptionBatch
  > | null>(null)
  const modeId = useId()
  const running = useRef(false)
  const ready =
    candidate?.attributes.some((a) => a.slug === 'description') &&
    candidate.price &&
    candidate.questions.length === 0 &&
    terms
  return (
    <section className="card intake-form reception-result">
      <h2>{d.aiTitle}</h2>
      <p>{available ? d.aiNotice : d.aiUnavailable}</p>
      <label htmlFor={modeId}>{d.batch.mode}</label>
      <select
        id={modeId}
        value={mode}
        disabled={attempted || busy}
        onChange={(e) => setMode(e.target.value as 'single' | 'batch')}
      >
        <option value="single">{d.batch.single}</option>
        <option value="batch">{d.batch.multiple}</option>
      </select>
      {mode === 'batch' && <p>{d.batch.notice}</p>}
      {available && (
        <Button
          disabled={busy || attempted || revision < 1}
          onClick={async () => {
            if (running.current || attempted) return
            running.current = true
            setBusy(true)
            setError('')
            setAttempted(true)
            try {
              const response = await fetch('/api/reception/assistance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  mode,
                  tenantId,
                  sessionId,
                  requestId: crypto.randomUUID(),
                  revision,
                }),
              })
              const result = await response.json()
              if (!response.ok)
                throw new Error(
                  result.error === 'ASSISTANCE_LIMIT'
                    ? d.aiLimit
                    : result.error === 'USAGE_QUOTA_EXCEEDED'
                      ? d.aiQuota
                      : result.error === 'AI_CREDITS_EXHAUSTED'
                        ? d.aiCredits
                        : result.error === 'AI_CAP_REACHED'
                          ? d.aiCap
                          : d.aiFailed,
                )
              if (result.status === 'unavailable')
                throw new Error(d.aiUnavailable)
              if (mode === 'batch') {
                if (
                  result.batch?.tenantId !== tenantId ||
                  result.batch?.sessionId !== sessionId ||
                  result.batch?.sellerId !== sellerId ||
                  result.batch?.baseRevision !== revision
                )
                  throw new Error(d.aiFailed)
                setBatch(
                  prepareReceptionBatch(
                    {
                      schemaVersion: 1,
                      tenantId,
                      sessionId,
                      sellerId,
                      revision,
                      sources,
                    },
                    {
                      candidates: result.batch.candidates,
                      questions: result.batch.questions,
                    },
                    result.batch.batchId,
                  ),
                )
                return
              }
              const proposal = receptionProposal.parse(result.proposal)
              if (
                proposal.tenantId !== tenantId ||
                proposal.sessionId !== sessionId ||
                proposal.sellerId !== sellerId ||
                proposal.baseRevision !== revision
              )
                throw new Error(d.aiFailed)
              setCandidate(proposal.suggestions)
            } catch (e) {
              setError(
                e instanceof Error &&
                  [d.aiLimit, d.aiUnavailable].includes(e.message)
                  ? e.message
                  : d.aiFailed,
              )
            } finally {
              running.current = false
              setBusy(false)
            }
          }}
        >
          {busy ? d.aiWorking : d.aiGenerate}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {attempted && <p>{d.aiTransient}</p>}
      {batch && (
        <BatchReview
          batch={batch}
          sources={sources}
          agreementId={terms?.id ?? null}
          agreementReady={!!terms || !agreementRequired}
          d={d}
        />
      )}
      {candidate && (
        <div className="intake-form">
          <h3>{d.aiCandidate}</h3>
          {candidate.attributes.map(
            (fact) =>
              fact && (
                <div key={fact.slug}>
                  <strong>
                    {(d.aiFields as Record<string, string | undefined>)[
                      fact.slug
                    ] ?? fact.slug}
                  </strong>
                  <p>{fact.value}</p>
                  <small>{d.aiUnverified}</small>
                  <details>
                    <summary>{d.aiSources}</summary>
                    {fact.sourceIds.map((id) => {
                      const source = sources.find((s) => s.id === id)
                      return (
                        <p key={id}>
                          {source?.kind === 'photo'
                            ? d.photoAlt
                            : source?.reference}{' '}
                          — {source?.observation || id}
                        </p>
                      )
                    })}
                  </details>
                </div>
              ),
          )}
          <h3>
            {d.price}:{' '}
            {candidate.price
              ? `${candidate.price.amount} ${candidate.price.currency}`
              : d.aiUnknown}
          </h3>
          {candidate.price && (
            <>
              <p>{candidate.price.rationale}</p>
              <details>
                <summary>{d.aiSources}</summary>
                {candidate.price.sourceIds.map((id) => (
                  <p key={id}>{sources.find((s) => s.id === id)?.reference}</p>
                ))}
              </details>
            </>
          )}
          {candidate.questions.length > 0 && (
            <>
              <h3>{d.aiQuestions}</h3>
              <ul>
                {candidate.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
          <p>{d.aiReviewNotice}</p>
          {terms && (
            <>
              <h3>
                {terms.title} ({d.version} {terms.version})
              </h3>
              <div className="reception-terms" lang={terms.language}>
                {terms.body}
              </div>
            </>
          )}
          {ready && candidate && (terms || !agreementRequired) ? (
            <PublishReview
              tenantId={tenantId}
              sessionId={sessionId}
              revision={revision}
              previousId={previousId}
              agreementId={terms?.id ?? null}
              suggestions={candidate}
              requireFieldReview
              d={d}
            />
          ) : (
            <p>{d.aiIncomplete}</p>
          )}
        </div>
      )}
    </section>
  )
}
