'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ShopifyIssue } from '@/extensions/shopify/auth'
import type { ShopifyConnectionStatus } from '@/lib/engine/shopify-connection'
import type { Dictionary } from '@/lib/i18n'

/** Connect a named shop, check and disconnect; nothing is exported or imported here. */
export function ShopifyConnection({
  tenantId,
  status,
  issue,
  outcome,
  expired,
  locale,
  d,
}: {
  tenantId: string
  status: ShopifyConnectionStatus
  issue: ShopifyIssue | null
  outcome: string | null
  expired: boolean
  locale: string
  d: Dictionary['shopify']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false),
    [shop, setShop] = useState('')
  const errors = d.errors as Record<string, string>
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  async function post(action: 'check' | 'disconnect') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(errors[body.error] ?? d.connectionFailed)
        return
      }
      setOk(true)
      if (action === 'disconnect') {
        setMessage(d.disconnected)
        window.location.reload()
        return
      }
      setMessage(
        `${d.connectionVerified} ${body.shopName} (${body.shopDomain}, ${body.currency}).`,
      )
    } catch {
      setMessage(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const outcomeText =
    outcome === 'connected'
      ? d.connected
      : outcome
        ? (errors[outcome] ?? d.connectionFailed)
        : ''
  const valid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(
    shop.trim().toLowerCase(),
  )
  const connectHref = `/api/integrations/shopify/connect?tenant=${tenantId}&shop=${encodeURIComponent(shop.trim().toLowerCase())}`
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      {outcomeText && <p role="status">{outcomeText}</p>}
      {status.connected ? (
        <p>
          {d.connectedTo} <strong>{status.shopName}</strong> (
          {status.shopDomain}, {status.currency})
          {status.connectedAt
            ? ` · ${d.since} ${when(status.connectedAt)}`
            : ''}
          {expired ? ` · ${d.expired}` : ''}
        </p>
      ) : (
        <p>{d.notConnected}</p>
      )}
      {issue ? (
        <p>
          {d[issue]} {d.configHint}
        </p>
      ) : (
        <div className="row">
          {!status.connected && (
            <div className="field">
              <label htmlFor="shopify-shop">{d.shopDomain}</label>
              <input
                id="shopify-shop"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                placeholder="my-store.myshopify.com"
                maxLength={120}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          )}
          {status.connected ? (
            <a
              className="btn"
              href={`/api/integrations/shopify/connect?tenant=${tenantId}&shop=${encodeURIComponent(status.shopDomain ?? '')}`}
            >
              {d.reconnect}
            </a>
          ) : (
            <a
              className={`btn${valid ? '' : ' disabled'}`}
              aria-disabled={!valid}
              href={valid ? connectHref : undefined}
            >
              {d.connect}
            </a>
          )}
          {status.connected && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => post('check')}
              >
                {busy ? d.busy : d.check}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => post('disconnect')}
              >
                {d.disconnect}
              </Button>
            </>
          )}
        </div>
      )}
      {message && <p role={ok ? 'status' : 'alert'}>{message}</p>}
      <p>
        <small>{d.notice}</small>
      </p>
      {status.events.length > 0 && (
        <ul>
          {status.events.map((e, i) => (
            <li key={i}>
              {when(e.occurredAt)} · {d.events[e.kind]}
              {typeof e.detail.shop_domain === 'string'
                ? ` · ${e.detail.shop_domain}`
                : ''}
              {typeof e.detail.reason === 'string'
                ? ` · ${errors[e.detail.reason] ?? e.detail.reason}`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
