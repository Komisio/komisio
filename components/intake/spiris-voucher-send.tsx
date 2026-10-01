'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { SpirisSendRow } from '@/lib/engine/spiris-vouchers'
import type { Dictionary } from '@/lib/i18n'

/** Sends one recorded export to Spiris as one voucher; shows the recorded outcome. */
export function SpirisVoucherSend({
  tenantId,
  exportId,
  send,
  connected,
  canSend,
  d,
}: {
  tenantId: string
  exportId: string
  send: SpirisSendRow | null
  connected: boolean
  canSend: boolean
  d: Dictionary['spiris']
}) {
  const running = useRef(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<{
    status: 'sent' | 'failed'
    number: string
    error: string
    detail: string
  } | null>(
    send && send.status !== 'pending'
      ? {
          status: send.status,
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
      const r = await fetch('/api/integrations/spiris', {
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
          number: body.voucherNumber,
          error: '',
          detail: '',
        })
        return
      }
      setState({
        status: 'failed',
        number: '',
        error: r.ok
          ? body.status === 'pending'
            ? 'SPIRIS_SEND_IN_PROGRESS'
            : body.errorCode
          : body.error,
        detail: typeof body.detail === 'string' ? body.detail : '',
      })
      setRequestId(crypto.randomUUID())
    } catch {
      setState({
        status: 'failed',
        number: '',
        error: 'SPIRIS_OUTCOME_UNKNOWN',
        detail: '',
      })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const held =
    send?.status === 'pending' ||
    state?.error === 'SPIRIS_OUTCOME_UNKNOWN' ||
    state?.error === 'SPIRIS_SEND_IN_PROGRESS'
  if (state?.status === 'sent')
    return (
      <span role="status">
        {d.voucherSent} {state.number}
      </span>
    )
  return (
    <span>
      {state?.status === 'failed' && (
        <span role="alert">
          {held ? d.voucherUnknown : d.voucherFailed}{' '}
          {errors[state.error] ?? d.connectionFailed}
          {state.detail ? ` ${d.spirisSaid} "${state.detail}"` : ''}{' '}
        </span>
      )}
      {held ? (
        send?.status === 'pending' && (
          <small>{d.errors.SPIRIS_SEND_IN_PROGRESS}</small>
        )
      ) : connected && canSend ? (
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
