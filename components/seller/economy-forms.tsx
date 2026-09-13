'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
export function SellerEconomyForms({
  tenantId,
  sellerId,
  currency,
  availableOre,
  thresholdOre,
  enabled,
  d,
}: {
  tenantId: string
  sellerId: string
  currency: string
  availableOre: number
  thresholdOre: number
  enabled: boolean
  d: Dictionary['sellerPortal']
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const retry = useRef<{ key: string; id: string } | null>(null)
  async function submit(payload: object) {
    setBusy(true)
    setNotice('')
    const key = JSON.stringify(payload)
    const id =
      retry.current?.key === key ? retry.current.id : crypto.randomUUID()
    retry.current = { key, id }
    try {
      const r = await fetch('/api/seller/economy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sellerId, requestId: id, ...payload }),
      })
      if (!r.ok) throw new Error()
      retry.current = null
      setNotice(d.saved)
      router.refresh()
    } catch {
      setNotice(d.error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="intake-grid">
      <form
        className="card intake-form"
        onSubmit={(e) => {
          e.preventDefault()
          const value = String(new FormData(e.currentTarget).get('amount'))
          if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(value)) {
            setNotice(d.error)
            return
          }
          const [whole, fraction = ''] = value.replace(',', '.').split('.')
          const amountOre =
            Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
          void submit({ action: 'requestPayout', amountOre })
        }}
      >
        <h2>{d.request}</h2>
        <p>{d.notice}</p>
        <p>
          {d.threshold}: {(thresholdOre / 100).toFixed(2)} {currency}
        </p>
        <label htmlFor="payout-amount">{d.amount}</label>
        <input
          id="payout-amount"
          name="amount"
          inputMode="decimal"
          required
          disabled={busy}
        />
        <Button
          type="submit"
          disabled={busy || availableOre < thresholdOre || availableOre <= 0}
        >
          {d.request}
        </Button>
      </form>
      <form
        className="card intake-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit({
            action: 'notifications',
            enabled: new FormData(e.currentTarget).get('emails') === 'on',
          })
        }}
      >
        <label className="row">
          <input
            type="checkbox"
            name="emails"
            defaultChecked={enabled}
            disabled={busy}
          />
          {d.emails}
        </label>
        <Button type="submit" disabled={busy}>
          {d.save}
        </Button>
      </form>
      <p role="status">{notice}</p>
    </div>
  )
}
