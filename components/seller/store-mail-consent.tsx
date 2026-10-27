'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { ConsentState } from '@/lib/engine/store-mail'

export function StoreMailConsent({
  tenantId,
  sellerId,
  current,
  recovery,
  d,
}: {
  tenantId: string
  sellerId: string
  current: ConsentState
  recovery: Pick<Dictionary['intake'], 'retry' | 'reload' | 'busy'>
  d: Dictionary['storeMail']
}) {
  const [enabled, setEnabled] = useState(current.enabled)
  const [busy, setBusy] = useBusyState(false)
  const [message, setMessage] = useState('')
  const [locked, setLocked] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const pending = useRef<{
    action: 'consent'
    tenantId: string
    sellerId: string
    requestId: string
    expected: string | null
    enabled: boolean
  } | null>(null)
  const expected = useRef(current.id)
  const router = useRouter()
  const running = useRef(false)
  async function save(value: boolean) {
    if (running.current || needsReload) return
    running.current = true
    setBusy(true)
    setMessage('')
    setLocked(true)
    pending.current ??= {
      action: 'consent',
      tenantId,
      sellerId,
      requestId: crypto.randomUUID(),
      expected: expected.current,
      enabled: value,
    }
    const request = pending.current
    try {
      const response = await fetch('/api/store-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        if (
          [
            'CONSENT_CHANGED',
            'REQUEST_CONFLICT',
            'FORBIDDEN',
            'AUTH_REQUIRED',
          ].includes(body?.error)
        ) {
          setNeedsReload(true)
          setMessage(d.changed)
          return
        }
        throw new Error('REQUEST_FAILED')
      }
      if (body?.data !== request.requestId) throw new Error('REQUEST_FAILED')
      expected.current = request.requestId
      pending.current = null
      setLocked(false)
      setMessage(d.saved)
      router.refresh()
    } catch {
      setMessage(d.error)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className="seller-email-setting"
      id="store-mail-consent"
      onSubmit={(event) => {
        event.preventDefault()
        void save(enabled)
      }}
    >
      <label className="seller-email-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || locked}
          onChange={(event) => {
            setEnabled(event.target.checked)
            void save(event.target.checked)
          }}
        />
        {d.consentLabel}
      </label>
      {locked && !needsReload && (
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? recovery.busy : recovery.retry}
        </Button>
      )}
      {needsReload && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {recovery.reload}
        </Button>
      )}
      {message && <p role={locked ? 'alert' : 'status'}>{message}</p>}
    </form>
  )
}
