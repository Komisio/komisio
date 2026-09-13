'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Records a counter sale of one accepted item. POS providers arrive through their own pull. */
export function SaleForm({
  tenantId,
  currency,
  items,
  d,
  intake,
}: {
  tenantId: string
  currency: string
  items: { id: string; label: string; priceOre: number | null }[]
  d: Dictionary['sales']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [externalId, setExternalId] = useState(() => crypto.randomUUID())
  const [priceError, setPriceError] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      fields = new FormData(form)
    setPriceError('')
    let price: string
    try {
      price = exactPrice(String(fields.get('price') ?? ''))
    } catch {
      setPriceError(d.priceInvalid)
      return
    }
    const id = await action.run({
      action: 'recordSale',
      tenantId,
      requestId,
      provider: 'manual',
      externalId,
      occurredAt: new Date().toISOString(),
      currency,
      lines: [{ itemId: String(fields.get('item')), price }],
    })
    if (id) {
      setSaved(id)
      setRequestId(crypto.randomUUID())
      setExternalId(crypto.randomUUID())
      form.reset()
      router.refresh()
    }
  }
  return (
    <section className="card intake-form">
      <h2>{d.recordHeading}</h2>
      <p>{d.recordHint}</p>
      {items.length === 0 ? (
        <p>{d.noItems}</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset
            className="intake-fields"
            disabled={action.busy || action.locked}
          >
            <div className="field">
              <label htmlFor="sale-item">{d.item}</label>
              <select id="sale-item" name="item" required>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sale-price">{d.price}</label>
              <input
                id="sale-price"
                name="price"
                required
                inputMode="decimal"
                placeholder="250"
              />
              <small>{d.priceHint}</small>
              {priceError && <p role="alert">{priceError}</p>}
            </div>
            <label className="intake-confirm">
              <input type="checkbox" required />
              {d.confirm}
            </label>
          </fieldset>
          {action.error && <p role="alert">{action.error}</p>}
          {action.needsReload && (
            <Link className="text-link" href="/intake/sales">
              {intake.reload}
            </Link>
          )}
          <Button type="submit" disabled={action.busy || action.needsReload}>
            {action.busy
              ? intake.busy
              : action.locked
                ? intake.retry
                : d.record}
          </Button>
          {saved && (
            <p role="status">
              {d.recorded}{' '}
              <Link className="text-link" href={`/intake/sales/${saved}`}>
                {d.open}
              </Link>
            </p>
          )}
        </form>
      )}
    </section>
  )
}
