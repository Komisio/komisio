'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
export function ZettleConnection({
  tenantId,
  available,
  d,
}: {
  tenantId: string
  available: boolean
  d: Dictionary['zettle']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false)
  async function check() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/zettle/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(
          (d.errors as Record<string, string>)[body.error] ??
            d.connectionFailed,
        )
        return
      }
      if (
        typeof body.organizationId !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(body.organizationId)
      )
        throw new Error('Invalid result')
      setOk(true)
      setMessage(
        `${d.connectionVerified} ${body.organizationId}. ${body.merchantPinned ? d.merchantPinned : d.merchantUnpinned}`,
      )
    } catch {
      setMessage(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form" aria-label={d.connectionTitle}>
      <h2>{d.connectionTitle}</h2>
      <p>{d.connectionHint}</p>
      {available ? (
        <Button type="button" onClick={() => void check()} disabled={busy}>
          {busy ? d.busy : d.checkConnection}
        </Button>
      ) : (
        <p>{d.connectionUnavailable}</p>
      )}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
    </section>
  )
}
