'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { EffectiveSellerTerms } from '@/lib/engine/seller-terms'
import { publishSellerTermsCommand } from '@/lib/engine/seller-terms'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Publishes a new seller terms version; an empty field means "use the store policy". */
export function SellerTermsForm({
  tenantId,
  sellerId,
  current,
  d,
  intake,
}: {
  tenantId: string
  sellerId: string
  current: EffectiveSellerTerms
  d: Dictionary['sellerTerms']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (action.locked) {
      if (await action.run({})) {
        setSaved(true)
        router.refresh()
      }
      return
    }
    const f = new FormData(event.currentTarget)
    const rate = String(f.get('rate') ?? '').trim()
    const candidate = publishSellerTermsCommand.safeParse({
      action: 'publishSellerTerms',
      tenantId,
      requestId,
      sellerId,
      expectedCurrentId: current.sellerTermsId,
      commissionBasis: f.get('basis') || null,
      commissionRatePercent: rate === '' ? null : Number(rate),
      notes: String(f.get('notes') ?? ''),
    })
    setInvalid(!candidate.success)
    if (!candidate.success) return
    if (await action.run(candidate.data)) {
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || saved || action.needsReload}
      >
        <div className="field">
          <label htmlFor="terms-basis">{d.commissionBasis}</label>
          <select
            id="terms-basis"
            name="basis"
            defaultValue={
              current.overrides.commissionBasis ? current.commissionBasis : ''
            }
          >
            <option value="">{d.usePolicy}</option>
            <option value="inclusive">{d.inclusive}</option>
            <option value="exclusive">{d.exclusive}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="terms-rate">{d.commissionRatePercent}</label>
          <input
            id="terms-rate"
            name="rate"
            type="number"
            min={0}
            max={100}
            step={0.01}
            placeholder={d.usePolicy}
            defaultValue={
              current.overrides.commissionRatePercent
                ? current.commissionRatePercent
                : ''
            }
          />
          <small>{d.rateHint}</small>
        </div>
        <div className="field">
          <label htmlFor="terms-notes">{d.notes}</label>
          <input
            id="terms-notes"
            name="notes"
            maxLength={500}
            defaultValue={current.notes}
          />
        </div>
        <label className="intake-confirm">
          <input type="checkbox" required />
          {d.confirm}
        </label>
      </fieldset>
      {(invalid || action.error) && (
        <p role="alert">{invalid ? intake.invalid : action.error}</p>
      )}
      {action.needsReload && (
        <a className="text-link" href={`/intake/sellers/${sellerId}`}>
          {intake.reload}
        </a>
      )}
      {!saved && (
        <Button type="submit" disabled={action.busy || action.needsReload}>
          {action.busy ? intake.busy : action.locked ? intake.retry : d.publish}
        </Button>
      )}
      {saved && <p role="status">{d.published}</p>}
    </form>
  )
}
