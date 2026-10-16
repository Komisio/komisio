// Changing the wording's meaning requires a new version, never rewriting history.
export const marketingConsentVersion = 'product-news-v1'
export function marketingConsentEnabled() {
  return process.env.KOMISIO_MARKETING_CONSENT_ENABLED === 'true'
}

export function signupMarketingMetadata(enabled: boolean, checked: boolean) {
  return enabled
    ? {
        marketing_consent: checked,
        marketing_consent_version: marketingConsentVersion,
      }
    : {}
}
