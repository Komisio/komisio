'use client'
import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import {
  syncPreference,
  type SyncPreference,
} from '@/lib/engine/sync-preferences'
import type { Dictionary } from '@/lib/i18n'

export function SyncPreferences({
  tenantId,
  initial,
  d,
  children,
  compact = false,
}: {
  tenantId: string
  initial: SyncPreference
  d: Dictionary
  children?: ReactNode
  compact?: boolean
}) {
  const t = d.itemSync.preferences
  const [base, setBase] = useState(initial)
  const [images, setImages] = useState(initial.images)
  const [busy, setBusy] = useBusyState(false)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState('')
  const [ok, setOk] = useState(false)
  const running = useRef(false)
  const pending = useRef<
    (SyncPreference & { tenantId: string; requestId: string }) | null
  >(null)
  useUnsavedChanges(images !== base.images || uncertain ? d.leaveUnsaved : null)
  async function save() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    pending.current ??= {
      ...base,
      images,
      tenantId,
      requestId: crypto.randomUUID(),
    }
    try {
      const response = await fetch('/api/integrations/sync-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status >= 500) throw new Error('uncertain')
        pending.current = null
        setUncertain(false)
        setMessage((t.errors as Record<string, string>)[body.error] ?? t.failed)
        return
      }
      const result = syncPreference.parse(body)
      setBase(result)
      setImages(result.images)
      pending.current = null
      setUncertain(false)
      setOk(true)
      setMessage(t.saved)
    } catch {
      setUncertain(true)
      setMessage(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className={
        compact
          ? 'pos-preferences sync-preferences'
          : 'card intake-form sync-preferences'
      }
      aria-label={`${d.itemSync.providers[initial.provider]} · ${t.title}`}
    >
      {!compact && <h2>{t.title}</h2>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={images}
            disabled={busy || uncertain}
            onChange={(event) => {
              setImages(event.target.checked)
              setMessage('')
              setOk(false)
            }}
          />
          {t.images}
        </label>
        {!compact && <p className="muted">{t.hint}</p>}
        <Button
          type="submit"
          disabled={busy || (!uncertain && images === base.images)}
        >
          {busy ? t.saving : uncertain ? d.itemSync.retry : t.save}
        </Button>
      </form>
      {compact && <small className="muted">{t.hint}</small>}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
      {children && (
        <>
          <hr />
          {children}
        </>
      )}
    </section>
  )
}
