'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

export function PurchaseForm({
  tenantId,
  d,
  intake,
}: {
  tenantId: string
  d: Dictionary['purchases']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState<string | null>(null)
  const [priceError, setPriceError] = useState('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget,
      fields = new FormData(form)
    setPriceError('')
    let purchasePrice: string
    try {
      purchasePrice = exactPrice(String(fields.get('price') ?? ''))
    } catch {
      setPriceError(d.priceInvalid)
      return
    }
    const id = await action.run({
      action: 'registerPurchase',
      tenantId,
      requestId,
      supplierNote: String(fields.get('note') ?? ''),
      purchasePrice,
      evidenceReference: String(fields.get('evidence') ?? ''),
      marginEligible: fields.get('margin') === 'on',
    })
    if (id) {
      setSaved(id)
      setRequestId(crypto.randomUUID())
      form.reset()
      router.refresh()
    }
  }
  return (
    <section className="card intake-form">
      <h2>{d.registerHeading}</h2>
      <p>{d.registerHint}</p>
      <form onSubmit={submit}>
        <fieldset
          className="intake-fields"
          disabled={action.busy || action.locked}
        >
          <div className="field">
            <label htmlFor="purchase-price">{d.price}</label>
            <input
              id="purchase-price"
              name="price"
              required
              inputMode="decimal"
              placeholder="150"
            />
            <small>{d.priceHint}</small>
            {priceError && <p role="alert">{priceError}</p>}
          </div>
          <div className="field">
            <label htmlFor="purchase-evidence">{d.evidence}</label>
            <input
              id="purchase-evidence"
              name="evidence"
              required
              maxLength={500}
            />
            <small>{d.evidenceHint}</small>
          </div>
          <div className="field">
            <label htmlFor="purchase-note">{d.note}</label>
            <input id="purchase-note" name="note" maxLength={500} />
          </div>
          <label className="intake-confirm">
            <input type="checkbox" name="margin" />
            {d.marginEligible}
          </label>
          <small>{d.marginHint}</small>
          <label className="intake-confirm">
            <input type="checkbox" required />
            {d.confirm}
          </label>
        </fieldset>
        {action.error && <p role="alert">{action.error}</p>}
        {action.needsReload && (
          <a className="text-link" href="/intake/purchases">
            {intake.reload}
          </a>
        )}
        <Button type="submit" disabled={action.busy || action.needsReload}>
          {action.busy
            ? intake.busy
            : action.locked
              ? intake.retry
              : d.register}
        </Button>
        {saved && <p role="status">{d.registered}</p>}
      </form>
    </section>
  )
}
