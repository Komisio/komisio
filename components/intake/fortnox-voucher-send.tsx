'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type {
  FortnoxSendRow,
  FortnoxPreview,
} from '@/lib/engine/fortnox-vouchers'
import type { Dictionary } from '@/lib/i18n'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { PayoutEvidence } from './payout-evidence'

/** Sends one recorded export to Fortnox as one voucher; shows the recorded outcome. */
export function FortnoxVoucherSend({
  tenantId,
  exportId,
  send,
  connected,
  canSend,
  d,
  accounting,
}: {
  tenantId: string
  exportId: string
  send: FortnoxSendRow | null
  connected: boolean
  canSend: boolean
  d: Dictionary['fortnox']
  accounting: Dictionary['accounting']
}) {
  const running = useRef(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useBusyState(false)
  const [preview, setPreview] = useState<FortnoxPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
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
  async function review() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setPreviewError('')
    try {
      const response = await fetch('/api/integrations/fortnox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, exportId, action: 'previewVoucher' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setPreview(result)
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : 'FORTNOX_READ_FAILED',
      )
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  async function post() {
    if (running.current || !preview || preview.blockedReason) return
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
          expectedBaselineSendId: preview.baselineSendId,
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
        error: r.ok
          ? body.status === 'pending'
            ? 'FORTNOX_SEND_IN_PROGRESS'
            : body.errorCode
          : body.error,
        detail: typeof body.detail === 'string' ? body.detail : '',
      })
      setRequestId(crypto.randomUUID())
      setPreview(null)
    } catch {
      setState({
        status: 'failed',
        series: '',
        number: null,
        error: 'FORTNOX_OUTCOME_UNKNOWN',
        detail: '',
      })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const held =
    send?.status === 'pending' ||
    state?.error === 'FORTNOX_OUTCOME_UNKNOWN' ||
    state?.error === 'FORTNOX_SEND_IN_PROGRESS'
  // A newly reviewed/confirmed attempt takes precedence over an older failed
  // row in the server props. Held attempts also expose their exact frozen lines.
  const lines = preview?.lines ?? send?.delta_voucher
  return (
    <div className="fortnox-send-status stack">
      {state?.status === 'sent' && (
        <span role="status">
          {d.voucherSent} {state.series}
          {state.number}
        </span>
      )}
      {lines && lines.length > 0 && (
        <details open={state?.status !== 'sent'}>
          <summary>{d.reviewDelivery}</summary>
          {(preview?.baselineSendId || send?.baseline_send_id) && (
            <p>{d.deltaHint}</p>
          )}
          <div
            className="economy-scroll"
            role="group"
            tabIndex={0}
            aria-label={d.reviewDelivery}
          >
            <table className="economy-table">
              <thead>
                <tr>
                  <th>{accounting.account}</th>
                  <th>{accounting.debit}</th>
                  <th>{accounting.credit}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.key}-${l.account}`}>
                    <th scope="row">{l.account}</th>
                    <td>
                      {l.side === 'debit'
                        ? `${formatSignedOre(l.amountOre)} SEK`
                        : '—'}
                    </td>
                    <td>
                      {l.side === 'credit'
                        ? `${formatSignedOre(l.amountOre)} SEK`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PayoutEvidence
            sources={preview?.payoutSources ?? send?.payout_sources}
            currency="SEK"
            d={accounting}
          />
        </details>
      )}
      {previewError && (
        <p role="alert">{errors[previewError] ?? d.connectionFailed}</p>
      )}
      {preview?.blockedReason && (
        <p role="status">
          {errors[preview.blockedReason] ?? d.connectionFailed}
        </p>
      )}
      {state?.status === 'failed' && (
        <span role="alert">
          {held ? d.voucherUnknown : d.voucherFailed}{' '}
          {errors[state.error] ?? d.connectionFailed}
          {state.detail ? ` ${d.fortnoxSaid} "${state.detail}"` : ''}{' '}
        </span>
      )}
      {held && (
        <Link className="text-link" href="/help/fortnox-recovery">
          {d.recoveryHelp}
        </Link>
      )}
      {state?.status === 'sent' ? null : held ? (
        send?.status === 'pending' && (
          <small>{d.errors.FORTNOX_SEND_IN_PROGRESS}</small>
        )
      ) : connected && canSend ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void (preview && !preview.blockedReason ? post() : review())
          }
        >
          {busy
            ? d.sending
            : preview && !preview.blockedReason
              ? d.sendVoucher
              : d.reviewDelivery}
        </Button>
      ) : (
        !connected && <small>{d.sendNeedsConnection}</small>
      )}
    </div>
  )
}
