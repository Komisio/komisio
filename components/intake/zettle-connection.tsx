'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
export function ZettleConnection({
  tenantId,
  connected,
  reconnectRequired,
  setupAvailable,
  result,
  d,
  compact = false,
  checkLabel,
}: {
  tenantId: string
  connected: boolean
  reconnectRequired: boolean
  setupAvailable: boolean
  result?: string
  d: Dictionary['zettle']
  compact?: boolean
  checkLabel?: string
}) {
  const running = useRef(false)
  const router = useRouter()
  const [busy, setBusy] = useBusyState(false)
  const [message, setMessage] = useState('')
  const [ok, setOk] = useState(false)
  const errorText = (code: string) => {
    if (code === 'PAYPAL_REFRESH_BUSY') return d.oauth.refreshBusy
    if (code === 'PAYPAL_APP_AUTH_FAILED') return d.oauth.appAuthFailed
    if (code === 'ZETTLE_AUTH_REQUIRED') return d.oauth.authorizationFailed
    if (
      [
        'PAYPAL_STATE_INVALID',
        'PAYPAL_CONNECTION_CHANGED',
        'PAYPAL_RECONNECT_REQUIRED',
      ].includes(code)
    )
      return d.oauth.retry
    if (code === 'PAYPAL_APP_UNAVAILABLE') return d.oauth.unavailable
    return (d.errors as Record<string, string>)[code] ?? d.connectionFailed
  }
  async function act(action: 'check' | 'disconnect') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/zettle/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(errorText(body.error))
        return
      }
      if (action === 'disconnect') {
        if (body.disconnected !== true) throw new Error('Invalid result')
        setMessage(d.oauth.disconnected)
        router.refresh()
      } else {
        if (typeof body.organizationId !== 'string')
          throw new Error('Invalid result')
        setMessage(d.connectionVerified)
      }
      setOk(true)
    } catch {
      setMessage(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const notice =
    result === 'connected'
      ? d.oauth.connected
      : result === 'cancelled'
        ? d.oauth.cancelled
        : result
          ? errorText(result)
          : ''
  return (
    <section
      className={compact ? 'pos-connection' : 'card intake-form'}
      aria-label={d.connectionTitle}
    >
      {!compact && <h2>{d.connectionTitle}</h2>}
      {(!connected || !compact) && <p>{d.oauth.hint}</p>}
      {notice && (
        <p
          role={
            result === 'connected' || result === 'cancelled'
              ? 'status'
              : 'alert'
          }
        >
          {notice}
        </p>
      )}
      {reconnectRequired && <p role="alert">{d.oauth.retry}</p>}
      {setupAvailable ? (
        <form
          method="post"
          action={`/api/integrations/paypal/connect?tenant=${encodeURIComponent(tenantId)}`}
          onSubmit={() => setBusy(true)}
        >
          <Button
            type="submit"
            variant={
              compact && connected && !reconnectRequired
                ? 'secondary'
                : 'primary'
            }
            disabled={busy}
          >
            {busy ? d.busy : connected ? d.oauth.reconnect : d.oauth.connect}
          </Button>
        </form>
      ) : (
        <p role="status">{d.oauth.unavailable}</p>
      )}
      {connected && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void act('check')}
            disabled={busy}
            variant={compact ? 'secondary' : 'primary'}
          >
            {checkLabel ?? d.checkConnection}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void act('disconnect')}
            disabled={busy}
          >
            {d.oauth.disconnect}
          </Button>
        </div>
      )}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
    </section>
  )
}
