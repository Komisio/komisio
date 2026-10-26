'use client'
import { storeCurrencies } from '@/lib/platform/currencies'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { locales, localeNames, type Dictionary } from '@/lib/i18n'
import type { StorePolicyBody } from '@/lib/engine/store-policy'
import { storePolicyBody } from '@/lib/engine/store-policy'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import {
  NavigationLink,
  useUnsavedChanges,
} from '@/components/platform/navigation-warning'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { feeAmountFromInput } from '@/lib/engine/consignment-fees'

function PolicySection({
  id,
  title,
  active,
  children,
}: {
  id: string
  title: string
  active: boolean
  children: ReactNode
}) {
  return (
    <section
      className="policy-section"
      id={`policy-section-${id}`}
      aria-labelledby={`policy-heading-${id}`}
      hidden={!active}
      tabIndex={-1}
    >
      <h3 id={`policy-heading-${id}`}>{title}</h3>
      <div className="policy-section-content">{children}</div>
    </section>
  )
}

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
  const [calendarPeriod, setCalendarPeriod] = useState(
    !!current.policy.consignmentPeriod,
  )
  const [invalid, setInvalid] = useState(false)
  const [monthlyFee, setMonthlyFee] = useState(
    !!current.policy.consignmentPeriod?.monthlyFee,
  )
  const [saved, setSaved] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const pendingHashTarget = useRef<Element | null>(null)
  const [activeSection, setActiveSection] = useState('receiving')
  const revealPolicyTarget = useCallback((target: Element | null) => {
    const section = target?.closest('.policy-section')
    if (section) setActiveSection(section.id.replace('policy-section-', ''))
  }, [])
  useLayoutEffect(() => {
    // A frame can run before React commits the section's hidden attribute.
    // Scroll only after the requested section has actually been revealed.
    pendingHashTarget.current?.scrollIntoView({ block: 'start' })
    pendingHashTarget.current = null
  }, [activeSection])
  useEffect(() => {
    function revealHash() {
      const id = window.location.hash.slice(1)
      if (!id.startsWith('policy-')) return
      const target = document.getElementById(id)
      if (!target || !form.current?.contains(target)) return
      const section = target.closest<HTMLElement>('.policy-section')
      if (section?.hidden) {
        pendingHashTarget.current = target
        revealPolicyTarget(target)
      } else {
        target.scrollIntoView({ block: 'start' })
      }
    }
    revealHash()
    window.addEventListener('hashchange', revealHash)
    return () => window.removeEventListener('hashchange', revealHash)
  }, [revealPolicyTarget])
  const action = useIntakeAction(d.intake),
    router = useRouter(),
    t = d.storePolicy
  const { ready, dirty, checkDirty } = useFormDirty(form)
  const stepsChanged =
    JSON.stringify(steps) !== JSON.stringify(base.policy.markdownSteps)
  useUnsavedChanges(
    editable && !saved && (dirty || stepsChanged || action.locked)
      ? d.leaveUnsaved
      : null,
  )
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
    vatModeConsignmentBusiness: ['consignment_business', 'consignment_margin'],
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
    ['pricing', t.editor.pricing],
    ['agreements', t.editor.agreements],
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
        </div>
        <span className="policy-version">
          {base.id ? `${t.version} ${base.version}` : t.defaults}
        </span>
      </header>
      <div className="policy-layout">
        <nav className="policy-navigation" aria-label={t.sectionLinks}>
          {sections.map(([id, title]) => (
            <a
              key={id}
              href={`#policy-section-${id}`}
              aria-current={activeSection === id ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault()
                setActiveSection(id)
                window.history.replaceState(
                  window.history.state,
                  '',
                  `#policy-section-${id}`,
                )
              }}
            >
              {title}
            </a>
          ))}
        </nav>
        <form
          ref={form}
          onChange={checkDirty}
          noValidate
          onSubmit={async (e) => {
            e.preventDefault()
            if (action.locked) {
              if (await action.run({})) {
                setSaved(true)
                router.refresh()
              }
              return
            }
            if (!e.currentTarget.checkValidity()) {
              const field = e.currentTarget.querySelector<HTMLInputElement>(
                'input:invalid, select:invalid, textarea:invalid',
              )
              revealPolicyTarget(field)
              requestAnimationFrame(() => {
                field?.focus()
                field?.reportValidity()
              })
              return
            }
            const f = new FormData(e.currentTarget)
            const input = { ...base.policy, markdownSteps: steps }
            for (const key of numbers) input[key] = Number(f.get(key))
            const rate = String(f.get('vatRatePercent') ?? '')
            const candidate = storePolicyBody.safeParse({
              ...input,
              collectionDays:
                !calendarPeriod &&
                String(f.get('dayCollectionDays') ?? '').trim() !== ''
                  ? Number(f.get('dayCollectionDays'))
                  : undefined,
              consignmentPeriod: calendarPeriod
                ? {
                    months: Number(f.get('consignmentMonths')),
                    collectionDays: Number(f.get('collectionDays')),
                    monthlyFee: monthlyFee
                      ? {
                          amountOre: feeAmountFromInput(
                            String(f.get('feeAmount') ?? ''),
                          ),
                          vatBasis: f.get('feeVatBasis'),
                          vatRatePercent:
                            String(f.get('feeVatRate') ?? '').trim() === ''
                              ? undefined
                              : Number(f.get('feeVatRate')),
                          collection: f.get('feeCollection'),
                        }
                      : undefined,
                  }
                : undefined,
              ...Object.fromEntries(
                Object.keys(vatModes).map((key) => [
                  key,
                  f.get(key) || undefined,
                ]),
              ),
              vatRatePercent: rate === '' ? undefined : Number(rate),
              photoSubmissionsEnabled:
                f.get('photoSubmissionsEnabled') === 'on',
              submissionPricing: f.get('submissionPricing'),
              assistanceEnabled: f.get('assistanceEnabled') === 'on',
              itemLanguage: f.get('itemLanguage'),
              communicationLanguage: f.get('communicationLanguage'),
              automaticSellerNotifications:
                f.get('automaticSellerNotifications') === 'on',
              automaticPeriodNotifications:
                f.get('automaticPeriodNotifications') === 'on',
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
            if (!candidate.success) {
              const path = candidate.error.issues[0]?.path ?? []
              const fields: Record<string, string> = {
                'consignmentPeriod.months': 'consignmentMonths',
                'consignmentPeriod.collectionDays': 'collectionDays',
                collectionDays: 'dayCollectionDays',
                'consignmentPeriod.monthlyFee.amountOre': 'feeAmount',
                'consignmentPeriod.monthlyFee.vatBasis': 'feeVatBasis',
                'consignmentPeriod.monthlyFee.vatRatePercent': 'feeVatRate',
                'consignmentPeriod.monthlyFee.collection': 'feeCollection',
              }
              const key = fields[path.join('.')] ?? String(path[0] ?? '')
              const target =
                form.current?.querySelector<HTMLElement>(`[name="${key}"]`) ??
                (['consignmentPeriod', 'markdownSteps'].includes(
                  String(path[0]),
                )
                  ? document.getElementById('policy-section-period')
                  : null)
              revealPolicyTarget(target)
              requestAnimationFrame(() => target?.focus())
              return
            }
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
            data-draft-readiness={!ready ? '' : undefined}
            className="intake-fields policy-fields"
            disabled={
              !ready ||
              !editable ||
              action.locked ||
              saved ||
              action.needsReload
            }
          >
            <PolicySection
              id="receiving"
              title={t.sectionReceiving}
              active={activeSection === 'receiving'}
            >
              {choiceField('intakeProfile')}
              <fieldset id="policy-custodySources">
                <legend>{t.custodySources}</legend>
                {subsets.custodySources.map((value) => (
                  <label className="intake-confirm" key={value}>
                    <input
                      type="checkbox"
                      name="custodySources"
                      value={value}
                      defaultChecked={base.policy.custodySources.includes(
                        value,
                      )}
                    />
                    {t[value]}
                  </label>
                ))}
              </fieldset>
              <label className="intake-confirm policy-option">
                <input
                  type="checkbox"
                  name="photoSubmissionsEnabled"
                  aria-label={d.submissions.enablePhotos}
                  aria-describedby="policy-photos-help"
                  defaultChecked={base.policy.photoSubmissionsEnabled !== false}
                />
                <span>
                  {d.submissions.enablePhotos}
                  <small id="policy-photos-help">{t.editor.photosHelp}</small>
                </span>
              </label>
            </PolicySection>
            <PolicySection
              id="pricing"
              title={t.editor.pricing}
              active={activeSection === 'pricing'}
            >
              <div className="field">
                <label htmlFor="policy-sellerReviewMode">
                  {t.editor.pricingReview}
                </label>
                <select
                  id="policy-sellerReviewMode"
                  name="sellerReviewMode"
                  defaultValue={base.policy.sellerReviewMode}
                  aria-describedby="policy-review-help"
                >
                  <option value="delegated">{t.editor.noReview}</option>
                  <option value="per_item">{t.editor.perItemReview}</option>
                </select>
                <small id="policy-review-help">
                  {t.editor.pricingReviewHelp}
                </small>
              </div>
              <div className="field">
                <label htmlFor="policy-submissionPricing">
                  {t.editor.submissionPricing}
                </label>
                <select
                  id="policy-submissionPricing"
                  name="submissionPricing"
                  defaultValue={base.policy.submissionPricing ?? 'store'}
                  aria-describedby="policy-submission-help"
                >
                  <option value="store">{t.editor.submissionStore}</option>
                  <option value="seller">{t.editor.submissionSeller}</option>
                  <option value="approval">
                    {t.editor.submissionApproval}
                  </option>
                </select>
                <small id="policy-submission-help">
                  {t.editor.submissionPricingHelp}
                </small>
              </div>
            </PolicySection>
            <PolicySection
              id="agreements"
              title={t.editor.agreements}
              active={activeSection === 'agreements'}
            >
              <fieldset
                id="policy-agreementRequiredFor"
                aria-describedby="policy-agreement-help"
              >
                <legend>{t.agreementRequiredFor}</legend>
                <p id="policy-agreement-help">{t.editor.agreementHelp}</p>
                {subsets.agreementRequiredFor.map((value, index) => (
                  <label className="intake-confirm policy-option" key={value}>
                    <input
                      type="checkbox"
                      name="agreementRequiredFor"
                      aria-label={t[value]}
                      aria-describedby={`policy-agreement-help-${value}`}
                      value={value}
                      defaultChecked={base.policy.agreementRequiredFor.includes(
                        value,
                      )}
                    />
                    <span>
                      {t[value]}
                      <small id={`policy-agreement-help-${value}`}>
                        {
                          [
                            t.editor.bagHelp,
                            t.editor.reviewHelp,
                            t.editor.acceptanceHelp,
                          ][index]
                        }
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="policy-note">{t.legacy}</p>
              <NavigationLink className="text-link" href="/intake/agreements">
                {d.agreements.manage}
              </NavigationLink>
            </PolicySection>
            <PolicySection
              id="economy"
              title={t.sectionEconomy}
              active={activeSection === 'economy'}
            >
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
              <details className="policy-help">
                <summary>{t.editor.more}</summary>
                <p>{t.currencyIntro}</p>
              </details>
            </PolicySection>
            <PolicySection
              id="period"
              title={t.sectionPeriod}
              active={activeSection === 'period'}
            >
              <fieldset>
                <legend>{t.consignmentCalendar}</legend>
                <label className="intake-confirm">
                  <input
                    type="checkbox"
                    name="consignmentCalendar"
                    checked={calendarPeriod}
                    onChange={(e) => setCalendarPeriod(e.target.checked)}
                  />
                  {t.consignmentCalendarEnabled}
                </label>
                <p>{t.consignmentCalendarHelp}</p>
                {!calendarPeriod && (
                  <div className="field">
                    <label htmlFor="day-collection-days">
                      {t.collectionDays}
                    </label>
                    <input
                      id="day-collection-days"
                      name="dayCollectionDays"
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      defaultValue={base.policy.collectionDays ?? ''}
                      aria-describedby="day-collection-help"
                    />
                    <p id="day-collection-help">{t.dayCollectionHelp}</p>
                  </div>
                )}
                {calendarPeriod && (
                  <div className="policy-grid">
                    <div className="field">
                      <label htmlFor="consignment-months">
                        {t.consignmentMonths}
                      </label>
                      <input
                        id="consignment-months"
                        name="consignmentMonths"
                        type="number"
                        min={1}
                        max={36}
                        step={1}
                        required
                        defaultValue={
                          base.policy.consignmentPeriod?.months ?? 3
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="collection-days">
                        {t.collectionDays}
                      </label>
                      <input
                        id="collection-days"
                        name="collectionDays"
                        type="number"
                        min={0}
                        max={365}
                        step={1}
                        required
                        defaultValue={
                          base.policy.consignmentPeriod?.collectionDays ?? 2
                        }
                      />
                    </div>
                    <label className="intake-confirm">
                      <input
                        type="checkbox"
                        name="monthlyFeeEnabled"
                        checked={monthlyFee}
                        onChange={(e) => setMonthlyFee(e.target.checked)}
                      />
                      {d.consignmentFees.enabled}
                    </label>
                    {monthlyFee && (
                      <>
                        <p>{d.consignmentFees.help}</p>
                        <label>
                          {d.consignmentFees.amount}
                          <input
                            name="feeAmount"
                            inputMode="decimal"
                            required
                            defaultValue={(
                              (base.policy.consignmentPeriod?.monthlyFee
                                ?.amountOre ?? 10000) / 100
                            ).toFixed(2)}
                          />
                        </label>
                        <div className="field">
                          <label htmlFor="policy-feeVatBasis">
                            {d.consignmentFees.vatBasis}
                          </label>
                          <select
                            id="policy-feeVatBasis"
                            name="feeVatBasis"
                            defaultValue={
                              base.policy.consignmentPeriod?.monthlyFee
                                ?.vatBasis ?? 'inclusive'
                            }
                          >
                            <option value="inclusive">{t.inclusive}</option>
                            <option value="exclusive">{t.exclusive}</option>
                          </select>
                        </div>
                        <label>
                          {d.consignmentFees.vatRate}
                          <input
                            name="feeVatRate"
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            required
                            defaultValue={
                              base.policy.consignmentPeriod?.monthlyFee
                                ?.vatRatePercent ?? ''
                            }
                          />
                        </label>
                        <div className="field">
                          <label htmlFor="policy-feeCollection">
                            {d.consignmentFees.collection}
                          </label>
                          <select
                            id="policy-feeCollection"
                            name="feeCollection"
                            defaultValue={
                              base.policy.consignmentPeriod?.monthlyFee
                                ?.collection ?? 'balance'
                            }
                          >
                            <option value="balance">
                              {d.consignmentFees.balance}
                            </option>
                            <option value="separate">
                              {d.consignmentFees.separate}
                            </option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </fieldset>
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
            </PolicySection>
            <PolicySection
              id="vat"
              title={t.vat}
              active={activeSection === 'vat'}
            >
              <details className="policy-help">
                <summary>{t.editor.more}</summary>
                <p>{t.vatIntro}</p>
              </details>
              {Object.entries(vatModes).map(([key, options]) => (
                <div className="field" key={key}>
                  <label htmlFor={`policy-${key}`}>
                    {t[key as keyof typeof vatModes]}
                  </label>
                  <select
                    id={`policy-${key}`}
                    name={key}
                    defaultValue={
                      base.policy[key as keyof typeof vatModes] ??
                      (key === 'vatModeConsignmentBusiness'
                        ? 'consignment_business'
                        : '')
                    }
                  >
                    <option
                      value=""
                      disabled={key === 'vatModeConsignmentBusiness'}
                    >
                      {t.vatNotChosen}
                    </option>
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
            </PolicySection>
            <PolicySection
              id="ai"
              title={t.sectionAi}
              active={activeSection === 'ai'}
            >
              <details className="policy-help">
                <summary>{t.editor.more}</summary>
                <p>{t.assistanceIntro}</p>
              </details>
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
            </PolicySection>
            <PolicySection
              id="notifications"
              title={t.notifications}
              active={activeSection === 'notifications'}
            >
              <details className="policy-help">
                <summary>{t.editor.more}</summary>
                <p>{t.notificationsIntro}</p>
              </details>
              <div className="field">
                <label htmlFor="policy-communication-language">
                  {t.communicationLanguage}
                </label>
                <select
                  id="policy-communication-language"
                  name="communicationLanguage"
                  defaultValue={base.policy.communicationLanguage ?? 'en'}
                  aria-describedby="policy-communication-language-hint"
                >
                  {locales.map((locale) => (
                    <option key={locale} value={locale}>
                      {localeNames[locale]}
                    </option>
                  ))}
                </select>
                <small id="policy-communication-language-hint">
                  {t.communicationLanguageHint}
                </small>
              </div>
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
              <label className="intake-confirm">
                <input
                  type="checkbox"
                  name="automaticPeriodNotifications"
                  defaultChecked={
                    base.policy.automaticPeriodNotifications !== false
                  }
                  aria-describedby="period-notices-hint"
                />
                {d.periodNotices.setting}
              </label>
              <small id="period-notices-hint">{d.periodNotices.hint}</small>
            </PolicySection>
          </fieldset>
          {editable && !saved && (
            <div className="policy-publish-bar" id="policy-publish">
              <label className="intake-confirm policy-confirm">
                <input
                  type="checkbox"
                  required
                  disabled={!ready || action.locked || action.needsReload}
                />
                {t.confirm}
              </label>
              <Button disabled={!ready || action.busy || action.needsReload}>
                {action.locked ? d.intake.retry : t.publish}
              </Button>
            </div>
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
