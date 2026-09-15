'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { z } from 'zod'
import type {
  shopifyCandidates,
  shopifyProductStatus,
} from '@/lib/engine/shopify-products'

/** Items for sale without a synced export at their current price, and the newest export per item. One item per click. */
export function ShopifyProducts({
  tenantId,
  candidates,
  products,
  currency,
  locale,
  d,
}: {
  tenantId: string
  candidates: z.infer<typeof shopifyCandidates>
  products: z.infer<typeof shopifyProductStatus>
  currency: string
  locale: string
  d: Dictionary['shopify']
}) {
  const running = useRef(false)
  const [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [ok, setOk] = useState(false)
  const errors = d.errors as Record<string, string>
  const statuses = d.productStatuses as Record<string, string>
  const tag = locale === 'sv' ? 'sv-SE' : 'en-GB'
  const amount = (ore: number) =>
    new Intl.NumberFormat(tag, { style: 'currency', currency }).format(
      ore / 100,
    )
  const when = (iso: string) =>
    new Date(iso).toLocaleString(tag, { timeZone: 'Europe/Stockholm' })
  async function exportItem(itemId: string) {
    if (running.current) return
    running.current = true
    setBusy(itemId)
    setMessage('')
    setOk(false)
    try {
      const r = await fetch('/api/integrations/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'exportItem', itemId }),
      })
      const body = await r.json()
      if (!r.ok) {
        setMessage(
          (errors[body.error] ?? d.exportFailed) +
            (typeof body.detail === 'string' ? ` ${body.detail}` : ''),
        )
        return
      }
      setOk(true)
      const images = d.imageStatuses as Record<string, string>
      setMessage(
        (body.updated ? d.exportedUpdated : d.exported) +
          (typeof body.image === 'string' && images[body.image]
            ? ` ${images[body.image]}`
            : ''),
      )
      window.location.reload()
    } catch {
      setMessage(d.exportFailed)
    } finally {
      running.current = false
      setBusy(null)
    }
  }
  return (
    <section className="card" aria-label={d.productsTitle}>
      <h2>{d.productsTitle}</h2>
      <p>{d.productsIntro}</p>
      {message && (
        <p role={ok ? 'status' : 'alert'} className={ok ? '' : 'error'}>
          {message}
        </p>
      )}
      <h3>{d.candidates}</h3>
      {candidates.length === 0 ? (
        <p>{d.noCandidates}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{d.item}</th>
                <th>{d.price}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.itemId}>
                  <td>
                    {c.title ?? c.reference}
                    <br />
                    <small>{c.reference}</small>
                  </td>
                  <td>{amount(c.priceOre)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => exportItem(c.itemId)}
                    >
                      {busy === c.itemId
                        ? d.exporting
                        : c.exportedBefore
                          ? d.exportAgain
                          : d.exportItem}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>{d.exportsTitle}</h3>
      {products.length === 0 ? (
        <p>{d.noExports}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{d.item}</th>
                <th>{d.price}</th>
                <th>{d.status}</th>
                <th>{d.photo}</th>
                <th>{d.when}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.exportId}>
                  <td>
                    {p.title}
                    <br />
                    <small>{p.reference}</small>
                  </td>
                  <td>
                    {p.price} {currency}
                  </td>
                  <td>
                    {statuses[p.status] ?? p.status}
                    {p.errorCode
                      ? ` · ${errors[p.errorCode] ?? p.errorCode}`
                      : ''}
                  </td>
                  <td>
                    {(d.imageStatuses as Record<string, string>)[
                      p.imageStatus ?? 'none'
                    ] ?? ''}
                  </td>
                  <td>{when(p.decidedAt ?? p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
