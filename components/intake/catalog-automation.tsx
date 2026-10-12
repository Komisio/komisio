'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import {
  catalogAutomation,
  type CatalogAutomation,
  type saveCatalogAutomationInput,
} from '@/lib/engine/catalog-automation'
import type { z } from 'zod'
import type { Dictionary } from '@/lib/i18n'

export function CatalogAutomationSettings({
  tenantId,
  initial,
  configured,
  canEdit,
  d,
  compact = false,
}: {
  tenantId: string
  initial: CatalogAutomation
  configured: boolean
  canEdit: boolean
  d: Dictionary
  compact?: boolean
}) {
  const t = d.itemSync.automatic
  const errors = d.itemSync.preferences
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useBusyState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const pending = useRef<z.infer<typeof saveCatalogAutomationInput> | null>(
    null,
  )
  useUnsavedChanges(uncertain ? d.leaveUnsaved : null)
  async function change() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    pending.current ??= {
      tenantId,
      requestId: crypto.randomUUID(),
      provider: state.provider,
      connectionId: state.connectionId,
      revision: state.revision,
      enabled: !state.enabled,
    }
    try {
      const response = await fetch('/api/integrations/catalog-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status >= 500) throw new Error('uncertain')
        pending.current = null
        setUncertain(false)
        setError(
          body.error === 'AUTOMATION_NOT_CONFIGURED'
            ? t.unavailable
            : ((errors.errors as Record<string, string>)[body.error] ??
                errors.failed),
        )
        return
      }
      setState(catalogAutomation.parse(body))
      pending.current = null
      setUncertain(false)
    } catch {
      setUncertain(true)
      setError(errors.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section
      aria-label={t.title}
      className={compact ? 'pos-automation' : 'intake-form'}
    >
      <h3>{t.title}</h3>
      {!compact && <p className="muted">{t.hint}</p>}
      <p
        role="status"
        className={
          compact
            ? `pos-status ${state.enabled ? 'pos-status-on' : ''}`
            : undefined
        }
      >
        {state.enabled ? t.on : t.off}
        {state.lastOutcome &&
          (state.enabled || state.lastOutcome !== 'running') && (
            <>
              {' '}
              ·{' '}
              <span title={state.lastAt ?? undefined}>
                {t.outcomes[state.lastOutcome]}
              </span>
            </>
          )}
      </p>
      {canEdit ? (
        <Button
          type="button"
          variant={compact ? 'secondary' : 'primary'}
          disabled={busy || (!configured && !state.enabled && !uncertain)}
          onClick={() => void change()}
        >
          {busy
            ? errors.saving
            : uncertain
              ? d.itemSync.retry
              : state.enabled
                ? t.disable
                : t.enable}
        </Button>
      ) : (
        <p className="muted">{t.ownerOnly}</p>
      )}
      {!configured && !state.enabled && (
        <p className="muted">{t.unavailable}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
