'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { ShopifyOrderStatus } from '@/lib/engine/shopify-orders'

/** Pull one page of paid orders; list the newest orders with their outcome; retry a failed one. */
export function ShopifyOrders({
  tenantId,
  status,
  locale,
  d,
}: {
  tenantId: string
  status: ShopifyOrderStatus
  locale: string
  d: Dictionary['shopify']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false)
  const errors = d.errors as Record<string, string>
  const reasons = d.holdReasons as Record<string, string>
  const tag = locale === 'sv' ? 'sv-SE' : 'en-GB'
  const amount = (ore: number, currency: string) =>
    new Intl.NumberFormat(tag, { style: 'currency', currency }).format(
      ore / 100,
    )
  const when = (iso: string) =>
    new Date(iso).toLocaleString(tag, { timeZone: 'Europe/Stockholm' })
  async function post(action: 'pullOrders' | 'retryOrder', orderId?: string) {
    if (running.current) return
    running.current = true
    setBusy(orderId ?? action)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action,
          ...(orderId ? { orderId } : {}),
          ...(action === 'pullOrders'
            ? { requestId: crypto.randomUUID() }
            : {}),
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(errors[body.error] ?? d.pullFailed)
        return
      }
      setOk(true)
      setMessage(
        action === 'retryOrder'
          ? body.saleId
            ? d.retried
            : d.retryStillHeld
          : body.replayed
            ? d.pulledNone
            : body.received === 0
              ? d.pulledNone
              : `${d.pulled} ${body.received}.`,
      )
      window.location.reload()
    } catch {
      setMessage(d.pullFailed)
    } finally {
      running.current = false
      setBusy(null)
    }
  }
  return (
    <section className="card" aria-label={d.ordersTitle}>
      <h2>{d.ordersTitle}</h2>
      <p>{d.ordersIntro}</p>
      <p>
        {status.lastPullAt
          ? `${d.lastPull} ${when(status.lastPullAt)}`
          : d.neverPulled}
        {status.held > 0 ? ` · ${d.heldCount} ${status.held}` : ''}
      </p>
      {message && (
        <p role={ok ? 'status' : 'alert'} className={ok ? '' : 'error'}>
          {message}
        </p>
      )}
      <div className="row">
        <Button disabled={busy !== null} onClick={() => post('pullOrders')}>
          {busy === 'pullOrders' ? d.pulling : d.pullOrders}
        </Button>
      </div>
      {status.orders.length === 0 ? (
        <p>{d.noOrders}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{d.order}</th>
                <th>{d.when}</th>
                <th>{d.amount}</th>
                <th>{d.status}</th>
              </tr>
            </thead>
            <tbody>
              {status.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.name}
                    <br />
                    <small>
                      {o.lines} {d.linesLabel}
                    </small>
                  </td>
                  <td>{when(o.occurredAt)}</td>
                  <td>{amount(o.amountOre, o.currency)}</td>
                  <td>
                    {o.saleId
                      ? d.orderRecorded
                      : o.holdReason
                        ? `${d.orderHeld}: ${reasons[o.holdReason] ?? o.holdReason}`
                        : o.errorCode
                          ? `${d.orderHeld}: ${errors[o.errorCode] ?? o.errorCode}`
                          : d.orderPending}
                    {!o.saleId && !o.holdReason && o.errorCode && (
                      <>
                        {' '}
                        <Button
                          variant="secondary"
                          disabled={busy !== null}
                          onClick={() => post('retryOrder', o.id)}
                        >
                          {busy === o.id ? d.pulling : d.retryOrder}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
