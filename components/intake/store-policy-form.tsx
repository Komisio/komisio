'use client'
import { storeCurrencies } from '@/lib/platform/currencies'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { locales, localeNames, type Dictionary } from '@/lib/i18n'
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
    intakeProfile: ['quick', 'standard', 'full'],
  } as const
  const subsets = {
    agreementRequiredFor: ['bag_receipt', 'review_publication', 'acceptance'],
    custodySources: ['staff_receipt', 'locker', 'seller_dropoff'],
  } as const
  // VAT modes are optional choices; an empty selection stays unchosen.
  const vatModes = {
    vatModeConsignmentPrivate: ['consignment_margin', 'consignment_full'],
    vatModeStoreOwned: ['store_margin', 'store_full'],
  } as const
  const numberField = (key: (typeof numbers)[number]) => (
    <div className="field" key={key}>
      <label htmlFor={`policy-${key}`}>{t[key]}</label>
      <input
        id={`policy-${key}`}
        name={key}
        type="number"
        required
        min={key === 'salePeriodDays' ? 1 : 0}
        max={key === 'commissionRatePercent' ? 100 : Number.MAX_SAFE_INTEGER}
        step={key.endsWith('Days') ? 1 : 0.01}
        defaultValue={base.policy[key]}
      />
    </div>
  )
  const choiceField = (key: keyof typeof choices) => (
    <div className="field" key={key}>
      <label htmlFor={`policy-${key}`}>{t[key]}</label>
      <select
        id={`policy-${key}`}
        name={key}
        defaultValue={
          base.policy[key] ?? (key === 'intakeProfile' ? 'quick' : undefined)
        }
      >
        {choices[key].map((value) => (
          <option key={value} value={value}>
            {t[value]}
          </option>
        ))}
      </select>
    </div>
  )
  const sections = [
    ['receiving', t.sectionReceiving],
    ['economy', t.sectionEconomy],
    ['period', t.sectionPeriod],
    ['vat', t.vat],
    ['ai', t.sectionAi],
    ['notifications', t.notifications],
  ] as const
  return (
    <section className="policy-editor" aria-label={t.title}>
      <header className="policy-header">
        <div>
          <h2>{t.title}</h2>
          <p>{t.layoutIntro}</p>
        </div>
        <span className="policy-version">
          {base.id ? `${t.version} ${base.version}` : t.defaults}
        </span>
      </header>
      <div className="policy-layout">
        <nav className="policy-navigation" aria-label={t.sectionLinks}>
          {sections.map(([id, title]) => (
            <a key={id} href={`#policy-section-${id}`}>
              {title}
            </a>
          ))}
          {editable && <a href="#policy-publish">{t.publish}</a>}
        </nav>
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
            const rate = String(f.get('vatRatePercent') ?? '')
            const candidate = storePolicyBody.safeParse({
              ...input,
              ...Object.fromEntries(
                Object.keys(vatModes).map((key) => [
                  key,
                  f.get(key) || undefined,
                ]),
              ),
              vatRatePercent: rate === '' ? undefined : Number(rate),
              assistanceEnabled: f.get('assistanceEnabled') === 'on',
              itemLanguage: f.get('itemLanguage'),
              automaticSellerNotifications:
                f.get('automaticSellerNotifications') === 'on',
              automaticMarkdowns: f.get('automaticMarkdowns') === 'on',
              currency: f.get('currency') || undefined,
              assistanceMonthlyQuota:
                String(f.get('assistanceMonthlyQuota') ?? '') === ''
                  ? undefined
                  : Number(f.get('assistanceMonthlyQuota')),
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
            className="intake-fields policy-fields"
            disabled={!editable || action.locked || saved || action.needsReload}
          >
            <section
              className="policy-section"
              id="policy-section-receiving"
              aria-labelledby="policy-heading-receiving"
            >
              <h3 id="policy-heading-receiving">{t.sectionReceiving}</h3>
              <div className="policy-grid">
                {choiceField('intakeProfile')}
                {choiceField('sellerReviewMode')}
              </div>
              <div className="policy-grid">
                {' '}
                {Object.entries(subsets).map(([key, options]) => (
                  <fieldset
                    key={key}
                    id={`policy-${key}`}
                    style={{ scrollMarginTop: '1rem' }}
                  >
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
              </div>
              <p className="policy-note">{t.legacy}</p>
            </section>
            <section
              className="policy-section"
              id="policy-section-economy"
              aria-labelledby="policy-heading-economy"
            >
              <h3 id="policy-heading-economy">{t.sectionEconomy}</h3>
              <div className="policy-grid">
                {numberField('commissionRatePercent')}
                {choiceField('commissionBasis')}
                {numberField('minPayoutThreshold')}

                <div className="field">
                  <label htmlFor="policy-currency">{t.currency}</label>
                  <select
                    id="policy-currency"
                    name="currency"
                    defaultValue={base.policy.currency ?? 'SEK'}
                  >
                    {storeCurrencies.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="policy-note">{t.currencyIntro}</p>
            </section>
            <section
              className="policy-section"
              id="policy-section-period"
              aria-labelledby="policy-heading-period"
            >
              <h3 id="policy-heading-period">{t.sectionPeriod}</h3>
              <div className="policy-grid">
                {numberField('salePeriodDays')}
                {numberField('unsoldNotifyAfterDays')}
                {choiceField('endOfPeriodAction')}
              </div>{' '}
              <fieldset>
                <legend>{t.markdownSteps}</legend>
                {steps.map((step, index) => (
                  <div key={index} className="policy-markdown-row">
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
                        variant="secondary"
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
                    variant="secondary"
                    onClick={() =>
                      setSteps([...steps, { afterDays: 0, percent: 0 }])
                    }
                  >
                    {t.add}
                  </Button>
                )}
              </fieldset>
              <fieldset>
                <legend>{t.markdowns}</legend>
                <p>{t.markdownsIntro}</p>
                <label className="intake-confirm">
                  <input
                    type="checkbox"
                    name="automaticMarkdowns"
                    defaultChecked={base.policy.automaticMarkdowns === true}
                  />
                  {t.automaticMarkdowns}
                </label>
              </fieldset>
            </section>
            <section
              className="policy-section"
              id="policy-section-vat"
              aria-labelledby="policy-heading-vat"
            >
              <h3 id="policy-heading-vat">{t.vat}</h3>
              <p>{t.vatIntro}</p>
              {Object.entries(vatModes).map(([key, options]) => (
                <div className="field" key={key}>
                  <label htmlFor={`policy-${key}`}>
                    {t[key as keyof typeof vatModes]}
                  </label>
                  <select
                    id={`policy-${key}`}
                    name={key}
                    defaultValue={
                      base.policy[key as keyof typeof vatModes] ?? ''
                    }
                  >
                    <option value="">{t.vatNotChosen}</option>
                    {options.map((value) => (
                      <option key={value} value={value}>
                        {t[value]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="field">
                <label htmlFor="policy-vatRatePercent">
                  {t.vatRatePercent}
                </label>
                <input
                  id="policy-vatRatePercent"
                  name="vatRatePercent"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  placeholder="25"
                  defaultValue={base.policy.vatRatePercent ?? ''}
                />
              </div>
            </section>
            <section
              className="policy-section"
              id="policy-section-ai"
              aria-labelledby="policy-heading-ai"
            >
              <h3 id="policy-heading-ai">{t.sectionAi}</h3>
              <p>{t.assistanceIntro}</p>
              <div className="field">
                <label htmlFor="policy-item-language">{t.itemLanguage}</label>
                <select
                  id="policy-item-language"
                  name="itemLanguage"
                  defaultValue={base.policy.itemLanguage ?? 'sv'}
                  aria-describedby="policy-item-language-hint"
                >
                  {locales.map((locale) => (
                    <option key={locale} value={locale}>
                      {localeNames[locale]}
                    </option>
                  ))}
                </select>
                <small id="policy-item-language-hint">
                  {t.itemLanguageHint}
                </small>
              </div>
              <label className="intake-confirm">
                <input
                  type="checkbox"
                  name="assistanceEnabled"
                  defaultChecked={base.policy.assistanceEnabled === true}
                />
                {t.assistanceEnabled}
              </label>
              <div className="field">
                <label htmlFor="assistanceMonthlyQuota">
                  {t.assistanceMonthlyQuota}
                </label>
                <input
                  id="assistanceMonthlyQuota"
                  name="assistanceMonthlyQuota"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000000}
                  step={1}
                  defaultValue={base.policy.assistanceMonthlyQuota ?? ''}
                />
                <small>{t.assistanceQuotaHint}</small>
              </div>
            </section>
            <section
              className="policy-section"
              id="policy-section-notifications"
              aria-labelledby="policy-heading-notifications"
            >
              <h3 id="policy-heading-notifications">{t.notifications}</h3>
              <p>{t.notificationsIntro}</p>
              <label className="intake-confirm">
                <input
                  type="checkbox"
                  name="automaticSellerNotifications"
                  defaultChecked={
                    base.policy.automaticSellerNotifications === true
                  }
                />
                {t.automaticSellerNotifications}
              </label>
            </section>
            {editable && (
              <label
                className="intake-confirm policy-confirm"
                id="policy-publish"
              >
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
      </div>
    </section>
  )
}
