'use client'
import { useRef, useState } from 'react'
import type { Dictionary, Locale } from '@/lib/i18n'
import {
  agreementSuggestion,
  type AgreementSuggestion,
} from '@/lib/assistance/agreement'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { z } from 'zod'
import type { RestoredAgreementDraft } from '@/lib/engine/agreement-assistance'

export function AgreementAssistant({
  tenantId,
  baseId,
  language,
  hasText,
  apply,
  d,
  busyChanged,
  initial,
  disabled,
}: {
  initial: RestoredAgreementDraft | null
  disabled: boolean
  tenantId: string
  baseId: string | null
  language: () => Locale
  hasText: () => boolean
  apply: (draft: AgreementSuggestion, language: Locale) => void
  d: Dictionary['agreements']['ai']
  busyChanged: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [draft, setDraft] = useState<AgreementSuggestion | null>(
      initial?.output ?? null,
    ),
    [replace, setReplace] = useState(false),
    [unknown, setUnknown] = useState(!!initial && !initial.output)
  const pending = useRef<{
    tenantId: string
    requestId: string
    baseId: string | null
    language: Locale
  } | null>(
    initial
      ? {
          tenantId,
          baseId,
          requestId: initial.requestId,
          language: initial.language,
        }
      : null,
  )
  const decision = useRef<{ id: string; choice: 'approve' | 'reject' } | null>(
    initial?.decisionId ? { id: initial.decisionId, choice: 'approve' } : null,
  )
  const [attempted, setAttempted] = useState<'approve' | 'reject' | null>(
    initial?.decisionId ? 'approve' : null,
  )
  const running = useRef(false)
  function lock(value: boolean) {
    running.current = value
    setBusy(value)
    busyChanged(value)
  }
  async function generate() {
    if (running.current || disabled) return
    pending.current ??= {
      tenantId,
      baseId,
      language: language(),
      requestId: crypto.randomUUID(),
    }
    lock(true)
    setError('')
    try {
      const r = await fetch('/api/agreements/assistance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      const raw = await r.json()
      if (!r.ok) {
        setError(
          raw.error === 'ASSISTANCE_DISABLED'
            ? d.unavailable
            : [
                  'AI_CREDITS_EXHAUSTED',
                  'AI_CAP_REACHED',
                  'USAGE_QUOTA_EXCEEDED',
                  'ASSISTANCE_LIMIT',
                ].includes(raw.error)
              ? d.limit
              : [
                    'AGREEMENT_CHANGED',
                    'TENANT_CHANGED',
                    'REQUEST_CONFLICT',
                  ].includes(raw.error)
                ? d.changed
                : d.failed,
        )
        // A definitive rejection before generation permits a new explicit attempt.
        if (
          [
            'ASSISTANCE_DISABLED',
            'AI_CREDITS_EXHAUSTED',
            'AI_CAP_REACHED',
            'USAGE_QUOTA_EXCEEDED',
            'ASSISTANCE_LIMIT',
          ].includes(raw.error)
        ) {
          pending.current = null
          setUnknown(false)
        } else setUnknown(true)
        return
      }
      const result = z
        .object({
          id: z.uuid(),
          status: z.enum(['pending', 'ready', 'failed']),
          output: agreementSuggestion.nullable(),
        })
        .parse(raw)
      if (result.id !== pending.current.requestId)
        throw Error('Mismatched response')
      if (result.status === 'ready' && result.output) {
        setDraft(result.output)
        setReplace(false)
        setUnknown(false)
      } else if (result.status === 'failed') {
        pending.current = null
        setUnknown(false)
        setError(d.failed)
      } else {
        setUnknown(true)
        setError(d.pending)
      }
    } catch {
      setUnknown(true)
      setError(d.pending)
    } finally {
      lock(false)
    }
  }
  async function decide(choice: 'approve' | 'reject') {
    if (running.current || disabled || !draft || !pending.current) return
    if (choice === 'approve' && hasText() && !replace) {
      setError(d.replace)
      return
    }
    lock(true)
    setError('')
    decision.current ??= { id: crypto.randomUUID(), choice }
    setAttempted(decision.current.choice)
    if (decision.current.choice !== choice) {
      lock(false)
      return
    }
    try {
      const r = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: decision.current.id,
          operationId: pending.current.requestId,
          decision: choice,
          reason: '',
        }),
      })
      const result = await r.json()
      if (
        !r.ok ||
        result.id !== decision.current.id ||
        result.outcome !== (choice === 'approve' ? 'executed' : 'rejected') ||
        (choice === 'approve' && result.resultId !== pending.current.requestId)
      ) {
        setError(d.changed)
        return
      }
      if (choice === 'approve') apply(draft, pending.current.language)
      setDraft(null)
      pending.current = null
      decision.current = null
      setAttempted(null)
      setReplace(false)
    } catch {
      setError(d.retryUse)
    } finally {
      lock(false)
    }
  }
  return (
    <div className="agreement-ai no-print">
      <div className="row wrap">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={generate}
          disabled={disabled || busy || !!draft}
        >
          {busy ? d.busy : unknown ? d.check : d.create}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {draft && (
        <div className="agreement-ai-preview">
          <FormHelpHeading
            title={d.preview}
            help={{ label: d.help, steps: [d.hint] }}
          />
          <h3>{draft.title}</h3>
          <div className="agreement-text">{draft.body}</div>
          {draft.questions.length > 0 && (
            <div>
              <strong>{d.questions}</strong>
              <ul>
                {draft.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {hasText() && (
            <label className="intake-confirm">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              {d.replace}
            </label>
          )}
          <div className="row wrap">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => decide('approve')}
              disabled={
                disabled ||
                busy ||
                (hasText() && !replace) ||
                attempted === 'reject'
              }
            >
              {d.use}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => decide('reject')}
              disabled={disabled || busy || attempted === 'approve'}
            >
              {d.close}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
