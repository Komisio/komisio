'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

const emptyFields = [
  ['price', ''],
  ['evidence', ''],
  ['note', ''],
] as const

export function PurchaseForm({
  tenantId,
  d,
  intake,
  leaveUnsaved,
}: {
  tenantId: string
  d: Dictionary['purchases']
  intake: Dictionary['intake']
  leaveUnsaved: string
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState<string | null>(null)
  const [priceError, setPriceError] = useState('')
  const priceRef = useRef<HTMLInputElement>(null)
  const submittedFields = useRef<FormData | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(
    formRef,
    emptyFields,
  )
  useUnsavedChanges(dirty || action.locked ? leaveUnsaved : null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || action.busy || action.needsReload) return
    const form = event.currentTarget,
      // Disabled fields are absent from new FormData. Validate the original
      // values on a locked retry, then let the action replay its frozen command.
      fields =
        action.locked && submittedFields.current
          ? submittedFields.current
          : new FormData(form)
    setPriceError('')
    let purchasePrice: string
    try {
      purchasePrice = exactPrice(String(fields.get('price') ?? ''))
    } catch {
      setPriceError(d.priceInvalid)
      priceRef.current?.focus()
      return
    }
    submittedFields.current = fields
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
      submittedFields.current = null
      setSaved(id)
      setRequestId(crypto.randomUUID())
      form.reset()
      const cleared = new FormData()
      for (const [name, value] of emptyFields) cleared.append(name, value)
      resetDirty(cleared)
      router.refresh()
    }
  }
  return (
    <section className="card intake-form">
      <h2>{d.registerHeading}</h2>
      <p>{d.registerHint}</p>
      <form
        ref={formRef}
        onSubmit={submit}
        onChange={() => {
          setSaved(null)
          checkDirty()
        }}
      >
        <fieldset
          className="intake-fields"
          disabled={!ready || action.busy || action.locked}
        >
          <div className="field">
            <label htmlFor="purchase-price">{d.price}</label>
            <input
              ref={priceRef}
              id="purchase-price"
              name="price"
              aria-invalid={!!priceError || undefined}
              aria-describedby={`purchase-price-hint${priceError ? ' purchase-price-error' : ''}`}
              onChange={() => setPriceError('')}
              required
              inputMode="decimal"
              placeholder="150"
            />
            <small id="purchase-price-hint">{d.priceHint}</small>
            {priceError && (
              <p id="purchase-price-error" role="alert">
                {priceError}
              </p>
            )}
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
        <Button
          type="submit"
          disabled={!ready || action.busy || action.needsReload}
        >
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
