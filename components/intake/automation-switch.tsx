'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AutomationGrant, AutomationScope } from '@/lib/engine/automation'

/** One owner switch for an automation scope: enable, disable, and the grant's state. */
export function AutomationSwitch({
  tenantId,
  scope,
  grants,
  configured,
  canEdit,
  t,
}: {
  tenantId: string
  scope: AutomationScope
  grants: AutomationGrant[] | null
  configured: boolean
  canEdit: boolean
  t: {
    heading: string
    hint: string
    enable: string
    disable: string
    enabled: string
    waiting: string
    off: string
    notConfigured: string
    ownerOnly: string
    busy: string
    failed: string
  }
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<AutomationGrant | null>(
    grants?.find((g) => g.scope === scope) ?? null,
  )
  async function post(action: 'enable' | 'disable') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/automation-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, scope, action }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(t.failed)
        return
      }
      setCurrent(
        (body.grants as AutomationGrant[]).find((g) => g.scope === scope) ??
          null,
      )
    } catch {
      setError(t.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form" aria-label={t.heading}>
      <h2>{t.heading}</h2>
      <p>{t.hint}</p>
      <p role="status">
        {current ? (current.accepted ? t.enabled : t.waiting) : t.off}
      </p>
      {!configured ? (
        <p>
          <small>{t.notConfigured}</small>
        </p>
      ) : canEdit ? (
        <Button
          type="button"
          variant={current ? 'secondary' : undefined}
          disabled={busy}
          onClick={() => void post(current ? 'disable' : 'enable')}
        >
          {busy ? t.busy : current ? t.disable : t.enable}
        </Button>
      ) : (
        <p>{t.ownerOnly}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
