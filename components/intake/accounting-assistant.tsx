'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { useRef, useState } from 'react'
import type { Dictionary, Locale } from '@/lib/i18n'
import {
  accountSuggestion,
  type AccountSuggestion,
} from '@/lib/accounting/account-suggestions'
import { z } from 'zod'
import type { RestoredAccountingDraft } from '@/lib/engine/accounting-assistance'
import { economicSuggestion } from '@/lib/accounting/economic-suggestions'

export function AccountingAssistant({
  tenantId,
  baseId,
  language,
  apply,
  d,
  busyChanged,
  initial,
  disabled,
  destination = 'sie',
  agreementNumber,
}: {
  initial: RestoredAccountingDraft | null
  disabled: boolean
  destination?: 'sie' | 'economic'
  agreementNumber?: number
  tenantId: string
  baseId: string | null
  language: () => Locale
  apply: (draft: AccountSuggestion, language: Locale) => void
  d: Dictionary['accounting']['ai']
  busyChanged: (busy: boolean) => void
}) {
  // Resume unconsumed results only on an explicit click. Already applied drafts
  // must not make a new Generate click silently reuse an older result.
  const restored = initial && !initial.decisionId ? initial : null
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  const [unknown, setUnknown] = useState(!!restored)
  const draft = useRef<AccountSuggestion | null>(restored?.output ?? null)
  const pending = useRef<{
    tenantId: string
    requestId: string
    baseId: string | null
    language: Locale
  } | null>(
    restored
      ? {
          tenantId,
          baseId,
          requestId: restored.requestId,
          language: restored.language,
        }
      : null,
  )
  const decision = useRef<string | null>(null)
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
      if (!draft.current) {
        const r = await fetch('/api/accounting/assistance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...pending.current,
            destination,
            ...(destination === 'economic' ? { agreementNumber } : {}),
          }),
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
                      'MAP_CHANGED',
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
            output: (destination === 'economic'
              ? economicSuggestion
              : accountSuggestion
            ).nullable(),
          })
          .parse(raw)
        if (result.id !== pending.current.requestId)
          throw Error('Mismatched response')
        if (result.status === 'ready' && result.output) {
          draft.current = result.output
        } else if (result.status === 'failed') {
          pending.current = null
          setUnknown(false)
          setError(d.failed)
          return
        } else {
          setUnknown(true)
          setError(d.pending)
          return
        }
      }
      // This explicit Suggest click fills blank editor fields; publication remains separate.
      // Keep the existing staged operation and its authorization/audit boundary.
      decision.current ??= crypto.randomUUID()
      const r = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: decision.current,
          operationId: pending.current.requestId,
          decision: 'approve',
          reason: '',
        }),
      })
      const result = await r.json()
      if (
        !r.ok ||
        result.id !== decision.current ||
        result.outcome !== 'executed' ||
        result.resultId !== pending.current.requestId
      ) {
        setError(d.changed)
        setUnknown(true)
        return
      }
      apply(draft.current, pending.current.language)
      draft.current = null
      pending.current = null
      decision.current = null
      setUnknown(false)
    } catch {
      setUnknown(true)
      setError(draft.current ? d.retryUse : d.pending)
    } finally {
      lock(false)
    }
  }
  return (
    <div className="accounting-ai no-print">
      <div className="row wrap">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={generate}
          aria-busy={busy}
          disabled={disabled || busy}
        >
          {busy ? d.busy : unknown ? d.check : d.create}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
