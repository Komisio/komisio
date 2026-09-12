'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { StorePolicyBody } from '@/lib/engine/store-policy'
import { storePolicyBody } from '@/lib/engine/store-policy'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

export function StorePolicyForm({
  tenantId,
  current,
  editable,
  d,
}: {
  tenantId: string
  current: { id: string | null; version: number; policy: StorePolicyBody }
  editable: boolean
  d: Dictionary
}) {
  const [base] = useState(current)
  const [steps, setSteps] = useState(current.policy.markdownSteps)
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  const action = useIntakeAction(d.intake),
    router = useRouter(),
    t = d.storePolicy
  const numbers = [
    'commissionRatePercent',
    'salePeriodDays',
    'unsoldNotifyAfterDays',
    'minPayoutThreshold',
  ] as const
  const choices = {
    commissionBasis: ['inclusive', 'exclusive'],
    sellerReviewMode: ['delegated', 'per_item'],
    endOfPeriodAction: ['charity', 'return'],
  } as const
  const subsets = {
    agreementRequiredFor: ['bag_receipt', 'review_publication', 'acceptance'],
    custodySources: ['staff_receipt', 'locker', 'seller_dropoff'],
  } as const
  return (
    <section className="card intake-form" aria-label={t.title}>
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      <p>{t.legacy}</p>
      <p>{base.id ? `${t.version} ${base.version}` : t.defaults}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (action.locked) {
            if (await action.run({})) {
              setSaved(true)
              router.refresh()
            }
            return
          }
          const f = new FormData(e.currentTarget)
          const input = { ...base.policy, markdownSteps: steps }
          for (const key of numbers) input[key] = Number(f.get(key))
          const candidate = storePolicyBody.safeParse({
            ...input,
            ...Object.fromEntries(
              Object.keys(choices).map((key) => [key, f.get(key)]),
            ),
            ...Object.fromEntries(
              Object.keys(subsets).map((key) => [key, f.getAll(key)]),
            ),
          })
          setInvalid(!candidate.success)
          if (!candidate.success) return
          if (
            await action.run({
              action: 'publishStorePolicy',
              tenantId,
              requestId: crypto.randomUUID(),
              expectedCurrentId: base.id,
              policy: candidate.data,
            })
          ) {
            setSaved(true)
            router.refresh()
          }
        }}
      >
        <fieldset
          className="intake-fields"
          disabled={!editable || action.locked || saved || action.needsReload}
        >
          {numbers.map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`policy-${key}`}>{t[key]}</label>
              <input
                id={`policy-${key}`}
                name={key}
                type="number"
                required
                min={key === 'salePeriodDays' ? 1 : 0}
                max={
                  key === 'commissionRatePercent'
                    ? 100
                    : Number.MAX_SAFE_INTEGER
                }
                step={key.endsWith('Days') ? 1 : 0.01}
                defaultValue={base.policy[key]}
              />
            </div>
          ))}
          {Object.entries(choices).map(([key, options]) => (
            <div className="field" key={key}>
              <label htmlFor={`policy-${key}`}>
                {t[key as keyof typeof choices]}
              </label>
              <select
                id={`policy-${key}`}
                name={key}
                defaultValue={base.policy[key as keyof typeof choices]}
              >
                {options.map((value) => (
                  <option key={value} value={value}>
                    {t[value]}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {Object.entries(subsets).map(([key, options]) => (
            <fieldset key={key}>
              <legend>{t[key as keyof typeof subsets]}</legend>
              {options.map((value) => (
                <label className="intake-confirm" key={value}>
                  <input
                    type="checkbox"
                    name={key}
                    value={value}
                    defaultChecked={(
                      base.policy[key as keyof typeof subsets] as string[]
                    ).includes(value)}
                  />
                  {t[value]}
                </label>
              ))}
            </fieldset>
          ))}
          <fieldset>
            <legend>{t.markdownSteps}</legend>
            {steps.map((step, index) => (
              <div key={index} className="field">
                <label>
                  {t.afterDays}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={step.afterDays}
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, i) =>
                          i === index
                            ? { ...s, afterDays: Number(e.target.value) }
                            : s,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  {t.percent}
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={step.percent}
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, i) =>
                          i === index
                            ? { ...s, percent: Number(e.target.value) }
                            : s,
                        ),
                      )
                    }
                  />
                </label>
                {editable && (
                  <Button
                    type="button"
                    onClick={() =>
                      setSteps(steps.filter((_, i) => i !== index))
                    }
                  >
                    {t.remove}
                  </Button>
                )}
              </div>
            ))}
            {editable && (
              <Button
                type="button"
                onClick={() =>
                  setSteps([...steps, { afterDays: 0, percent: 0 }])
                }
              >
                {t.add}
              </Button>
            )}
          </fieldset>
          {editable && (
            <label className="intake-confirm">
              <input type="checkbox" required />
              {t.confirm}
            </label>
          )}
        </fieldset>
        {editable && !saved && (
          <Button disabled={action.busy || action.needsReload}>
            {action.locked ? d.intake.retry : t.publish}
          </Button>
        )}
        {saved && <p role="status">{t.saved}</p>}
        {(invalid || action.error) && (
          <p role="alert">{invalid ? d.intake.invalid : action.error}</p>
        )}
        {action.needsReload && (
          <Button type="button" onClick={() => location.reload()}>
            {d.intake.reload}
          </Button>
        )}
      </form>
    </section>
  )
}
