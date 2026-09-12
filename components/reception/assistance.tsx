'use client'
import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import {
  receptionProposal,
  type ReceptionSuggestions,
  type ReceptionSession,
} from '@/lib/engine/reception'
import { Button } from '@/components/ui/button'
import { PublishReview } from './operator'

export function ReceptionAssistance({
  tenantId,
  sessionId,
  sellerId,
  revision,
  sources,
  available,
  terms,
  previousId,
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
  previousId: string | null
  d: Dictionary['reception']
}) {
  const [candidate, setCandidate] = useState<ReceptionSuggestions | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempted, setAttempted] = useState(false)
  const running = useRef(false)
  const ready =
    candidate?.metadata.description &&
    candidate.price &&
    candidate.questions.length === 0 &&
    terms
  const reviewed = candidate
    ? {
        ...candidate,
        metadata: Object.fromEntries(
          Object.entries(candidate.metadata).map(([key, fact]) => [
            key,
            { ...fact, certainty: 'observed' as const },
          ]),
        ),
      }
    : null
  return (
    <section className="card intake-form reception-result">
      <h2>{d.aiTitle}</h2>
      <p>{available ? d.aiNotice : d.aiUnavailable}</p>
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
                  tenantId,
                  sessionId,
                  requestId: crypto.randomUUID(),
                  revision,
                }),
              })
              const result = await response.json()
              if (!response.ok)
                throw new Error(
                  result.error === 'ASSISTANCE_LIMIT' ? d.aiLimit : d.aiFailed,
                )
              if (result.status === 'unavailable')
                throw new Error(d.aiUnavailable)
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
      {candidate && (
        <div className="intake-form">
          <h3>{d.aiCandidate}</h3>
          {Object.entries(candidate.metadata).map(
            ([key, fact]) =>
              fact && (
                <div key={key}>
                  <strong>{d.aiFields[key as keyof typeof d.aiFields]}</strong>
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
            {candidate.price ? `${candidate.price.amount} SEK` : d.aiUnknown}
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
          {ready && reviewed && terms ? (
            <PublishReview
              tenantId={tenantId}
              sessionId={sessionId}
              revision={revision}
              previousId={previousId}
              agreementId={terms.id}
              suggestions={reviewed}
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
