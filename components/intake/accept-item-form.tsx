'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { OriginKind } from '@/lib/engine/items'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Commercial acceptance of one origin. SQL rechecks every precondition and freezes terms. */
export function AcceptItemForm({
  tenantId,
  originKind,
  originId,
  originRevision,
  defaultPrice,
  d,
  intake,
}: {
  tenantId: string
  originKind: OriginKind
  originId: string
  originRevision: number | null
  defaultPrice?: string
  d: Dictionary['items']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [priceError, setPriceError] = useState('')
  const submittedFields = useRef<FormData | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPriceError('')
    // A disabled fieldset is omitted by FormData. Keep the submitted values
    // available for local validation while the action owns a frozen retry.
    const fields =
      action.locked && submittedFields.current
        ? submittedFields.current
        : new FormData(event.currentTarget)
    let price: string
    try {
      price = exactPrice(String(fields.get('price')))
    } catch {
      setPriceError(d.priceInvalid)
      return
    }
    submittedFields.current = fields
    const id = await action.run({
      action: 'acceptItem',
      tenantId,
      requestId,
      originKind,
      originId,
      originRevision,
      price,
    })
    if (id) {
      submittedFields.current = null
      setSaved(id)
      router.refresh()
    }
  }
  const field = `accept-price-${originId}`
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || !!saved}
      >
        <div className="field">
          <label htmlFor={field}>{d.price}</label>
          <input
            id={field}
            name="price"
            required
            inputMode="decimal"
            defaultValue={defaultPrice}
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
        <Button type="button" onClick={() => location.reload()}>
          {intake.reload}
        </Button>
      )}
      {!saved && (
        <Button type="submit" disabled={action.busy || action.needsReload}>
          {action.busy ? intake.busy : action.locked ? intake.retry : d.accept}
        </Button>
      )}
      {saved && (
        <p role="status">
          {d.accepted}{' '}
          <a className="text-link" href={`/intake/items/${saved}`}>
            {d.open}
          </a>
        </p>
      )}
    </form>
  )
}
