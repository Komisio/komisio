import type { Dictionary } from '@/lib/i18n'

export function MarketingConsentField({
  d,
  defaultChecked = false,
  disabled = false,
}: {
  d: Dictionary
  defaultChecked?: boolean
  disabled?: boolean
}) {
  return (
    <div className="field">
      <label className="marketing-consent-choice">
        <input
          type="checkbox"
          name="marketingConsent"
          defaultChecked={defaultChecked}
          disabled={disabled}
          aria-describedby="marketing-consent-help"
        />
        {d.marketingConsentLabel}
      </label>
      <small id="marketing-consent-help">{d.marketingConsentHelp}</small>
    </div>
  )
}
