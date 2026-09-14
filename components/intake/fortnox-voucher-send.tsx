'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { FortnoxSendRow } from '@/lib/engine/fortnox-vouchers'
import type { Dictionary } from '@/lib/i18n'

/** Sends one recorded export to Fortnox as one voucher; shows the recorded outcome. */
export function FortnoxVoucherSend({
  tenantId,
  exportId,
  send,
  connected,
  canSend,
  d,
}: {
  tenantId: string
  exportId: string
  send: FortnoxSendRow | null
  connected: boolean
  canSend: boolean
  d: Dictionary['fortnox']
}) {
  const running = useRef(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<{
    status: 'sent' | 'failed'
    series: string
    number: number | null
    error: string
    detail: string
  } | null>(
    send && send.status !== 'pending'
      ? {
          status: send.status,
          series: send.voucher_series,
          number: send.voucher_number,
          error: send.error_code,
          detail: send.detail,
        }
      : null,
  )
  const errors = d.errors as Record<string, string>
  async function post() {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      const r = await fetch('/api/integrations/fortnox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'sendVoucher',
          exportId,
          requestId,
        }),
      })
      const body = await r.json()
      if (r.ok && body.status === 'sent') {
        setState({
          status: 'sent',
          series: body.voucherSeries,
          number: body.voucherNumber,
          error: '',
          detail: '',
        })
        return
      }
      setState({
        status: 'failed',
        series: '',
        number: null,
        error: r.ok ? body.errorCode : body.error,
        detail: typeof body.detail === 'string' ? body.detail : '',
      })
      setRequestId(crypto.randomUUID())
    } catch {
      setState({
        status: 'failed',
        series: '',
        number: null,
        error: '',
        detail: '',
      })
      setRequestId(crypto.randomUUID())
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  if (state?.status === 'sent')
    return (
      <span role="status">
        {d.voucherSent} {state.series}
        {state.number}
      </span>
    )
  return (
    <span>
      {state?.status === 'failed' && (
        <span role="alert">
          {d.voucherFailed} {errors[state.error] ?? d.connectionFailed}
          {state.detail ? ` ${d.fortnoxSaid} "${state.detail}"` : ''}{' '}
        </span>
      )}
      {connected && canSend ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void post()}
        >
          {busy ? d.sending : state ? d.sendAgain : d.sendVoucher}
        </Button>
      ) : (
        !connected && <small>{d.sendNeedsConnection}</small>
      )}
    </span>
  )
}
