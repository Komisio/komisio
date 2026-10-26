'use client'
import { RegistrationFields } from './registration-fields'
import {
  questionsFor,
  labelOf,
  type AttributeVocabulary,
} from '@/lib/engine/attributes'
import { useRef, useState } from 'react'
import { NavigationLink } from '@/components/platform/navigation-warning'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { useIntakeAction } from './use-intake-action'
import { ReloadAction } from './reload-action'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

export function PurchaseForm({
  tenantId,
  d,
  intake,
  leaveUnsaved,
  registration,
  descriptionRequired = false,
  vocabulary,
  locale = 'sv',
  itemTypeLabel,
}: {
  tenantId: string
  d: Dictionary['purchases']
  intake: Dictionary['intake']
  registration?: Dictionary['registration']
  vocabulary?: AttributeVocabulary
  locale?: string
  itemTypeLabel?: string
  descriptionRequired?: boolean
  leaveUnsaved: string
}) {
  const [itemType, setItemType] = useState('')
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState<string | null>(null)
  const [priceError, setPriceError] = useState('')
  const priceRef = useRef<HTMLInputElement>(null)
  const submittedFields = useRef<FormData | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(formRef)
  useUnsavedChanges(
    !action.needsReload && (dirty || action.locked) ? leaveUnsaved : null,
  )
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
      internalNote: String(fields.get('internalNote') ?? ''),
      ...(vocabulary
        ? {
            itemType: itemType || null,
            facts: Object.fromEntries(
              questionsFor(vocabulary, itemType || null)
                .filter((q) => q.definition.slug !== 'description')
                .flatMap(({ definition: a }) => {
                  const value = String(
                    fields.get(`attribute-${a.slug}`) ?? '',
                  ).trim()
                  return value ? [[a.slug, value]] : []
                }),
            ),
          }
        : {}),
      purchasePrice,
      evidenceReference: String(fields.get('evidence') ?? ''),
      marginEligible: fields.get('margin') === 'on',
    })
    if (id) {
      submittedFields.current = null
      setSaved(id)
      setRequestId(crypto.randomUUID())
      form.reset()
      setItemType('')
      const cleared = new FormData()
      cleared.append('note', '')
      if (registration) cleared.append('internalNote', '')
      if (vocabulary) {
        cleared.append('itemType', '')
        for (const { definition: a } of questionsFor(vocabulary, null))
          if (a.slug !== 'description' && a.data_type !== 'boolean')
            cleared.append(`attribute-${a.slug}`, '')
      }
      cleared.append('price', '')
      cleared.append('evidence', '')
      resetDirty(cleared)
      router.refresh()
    }
  }
  return (
    <section className="card intake-form">
      <FormHelpHeading
        title={d.registerHeading}
        help={{
          label: d.helpLabel,
          steps: [d.registerHint, d.evidenceHint, d.priceHint, d.intro],
        }}
      />
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
            <label htmlFor="purchase-note">{d.note}</label>
            <input
              id="purchase-note"
              name="note"
              maxLength={500}
              required={descriptionRequired}
            />
            {registration && (
              <>
                <label htmlFor="purchase-internal-note">
                  {registration.note}
                </label>
                <textarea
                  id="purchase-internal-note"
                  name="internalNote"
                  maxLength={2000}
                />
                <small>{registration.noteHint}</small>
              </>
            )}
          </div>
          {vocabulary && (
            <>
              <div className="field">
                <label htmlFor="purchase-type">{itemTypeLabel}</label>
                <select
                  id="purchase-type"
                  name="itemType"
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value)}
                >
                  <option value="">—</option>
                  {vocabulary.types
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {labelOf(t, locale)}
                      </option>
                    ))}
                </select>
              </div>
              <RegistrationFields
                vocabulary={vocabulary}
                itemType={itemType || null}
                locale={locale}
              />
            </>
          )}
          <div className="field">
            <label htmlFor="purchase-price">{d.price}</label>
            <input
              ref={priceRef}
              id="purchase-price"
              name="price"
              aria-invalid={!!priceError || undefined}
              aria-describedby={priceError ? 'purchase-price-error' : undefined}
              onChange={() => setPriceError('')}
              required
              inputMode="decimal"
              placeholder="150"
            />
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
          </div>
          <h2>{d.taxHeading}</h2>
          <label className="intake-confirm">
            <input type="checkbox" name="margin" />
            {d.marginEligible}
          </label>
        </fieldset>
        {action.error && <p role="alert">{action.error}</p>}
        {action.needsReload && <ReloadAction label={intake.reload} />}
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
        {saved && (
          <>
            <p role="status">{d.registered}</p>
            <NavigationLink
              className="btn btn-secondary"
              href={`/intake/purchases?purchase=${saved}#purchases-history`}
            >
              {d.continueToItem}
            </NavigationLink>
          </>
        )}
      </form>
    </section>
  )
}
