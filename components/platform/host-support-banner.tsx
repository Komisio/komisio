'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { HostSupportState } from '@/lib/engine/host-support'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import './host-support.css'

export function HostSupportBanner({
  support,
  d,
  locale,
  watchExpiry = true,
}: {
  support: HostSupportState
  d: Dictionary['hostSupport']
  locale: string
  watchExpiry?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  useEffect(() => {
    if (!support.available || !watchExpiry) return
    const expire = () => window.location.replace('/support')
    // Use server time; an incorrectly set computer clock must not cause a loop.
    const remaining =
      Date.parse(support.expiresAt) - Date.parse(support.serverNow)
    const deadline = performance.now() + remaining
    const timer = window.setTimeout(expire, Math.max(0, remaining))
    // Restore a suspended/background tab without retaining the old workspace.
    const check = () => {
      if (performance.now() >= deadline) expire()
    }
    window.addEventListener('focus', check)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', check)
    }
  }, [support.available, support.expiresAt, support.serverNow, watchExpiry])
  async function end() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/host/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'end', id: support.id }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error('END_FAILED')
      // Drop cached store layouts and drafts when the access context changes.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/host')
    } catch {
      setError(d.exitFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="host-support-banner" aria-label={d.mode}>
      <div>
        <strong>{d.heading.replace('{name}', support.tenant.name)}</strong>
        <p>{support.available ? d.readOnly : d.expired}</p>
        {support.available && (
          <small>
            {d.until.replace(
              '{time}',
              new Date(support.expiresAt).toLocaleTimeString(
                intlLocale(locale),
                {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Europe/Stockholm',
                  timeZoneName: 'short',
                },
              ),
            )}
          </small>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void end()}
      >
        {busy ? d.working : d.end}
      </Button>
    </section>
  )
}
