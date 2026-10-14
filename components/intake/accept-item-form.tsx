'use client'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { OriginKind } from '@/lib/engine/items'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import {
  NavigationLink,
  useUnsavedChanges,
} from '@/components/platform/navigation-warning'

/** Commercial acceptance of one origin. SQL rechecks every precondition and freezes terms. */
export function AcceptItemForm({
  tenantId,
  originKind,
  originId,
  originRevision,
  defaultPrice,
  d,
  intake,
  leaveUnsaved,
  compact = false,
}: {
  tenantId: string
  originKind: OriginKind
  originId: string
  originRevision: number | null
  defaultPrice?: string
  d: Dictionary['items']
  intake: Dictionary['intake']
  leaveUnsaved: string
  compact?: boolean
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [priceError, setPriceError] = useState('')
  const priceRef = useRef<HTMLInputElement>(null)
  const submittedFields = useRef<FormData | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty } = useFormDirty(formRef)
  useUnsavedChanges(
    !saved && !action.needsReload && (dirty || action.locked)
      ? leaveUnsaved
      : null,
    'item-acceptance',
  )
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || action.busy || action.needsReload || saved) return
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
      priceRef.current?.focus()
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
  const inline = compact && originKind === 'purchase'
  return (
    <form
      className={inline ? 'purchase-inline' : undefined}
      ref={formRef}
      onSubmit={submit}
      onChange={checkDirty}
    >
      <fieldset
        className="intake-fields"
        data-draft-readiness
        disabled={!ready || action.busy || action.locked || !!saved}
      >
        <div className="field">
          <label htmlFor={field}>
            {originKind === 'purchase' ? d.purchaseSalePrice : d.price}
          </label>
          <input
            ref={priceRef}
            id={field}
            name="price"
            aria-invalid={!!priceError || undefined}
            aria-describedby={
              inline
                ? priceError
                  ? `${field}-error`
                  : undefined
                : `${field}-hint${priceError ? ` ${field}-error` : ''}`
            }
            onChange={() => setPriceError('')}
            required
            inputMode="decimal"
            defaultValue={defaultPrice}
            placeholder="250"
          />
          {!inline && (
            <small id={`${field}-hint`}>
              {originKind === 'purchase' ? d.purchasePriceHint : d.priceHint}
            </small>
          )}
          {priceError && (
            <p id={`${field}-error`} role="alert">
              {priceError}
            </p>
          )}
        </div>
        {!inline && (
          <label className="intake-confirm">
            <input type="checkbox" name="confirmed" required />
            {d.confirm}
          </label>
        )}
      </fieldset>
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && (
        <Button type="button" onClick={() => location.reload()}>
          {intake.reload}
        </Button>
      )}
      {!saved && (
        <Button
          type="submit"
          disabled={!ready || action.busy || action.needsReload}
        >
          {action.busy
            ? intake.busy
            : action.locked
              ? intake.retry
              : inline
                ? d.createPurchasedItem
                : d.accept}
        </Button>
      )}
      {saved && (
        <p role="status">
          {d.accepted}{' '}
          <NavigationLink className="text-link" href={`/intake/items/${saved}`}>
            {d.open}
          </NavigationLink>
        </p>
      )}
    </form>
  )
}
