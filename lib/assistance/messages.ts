import type { Dictionary } from '@/lib/i18n'

// The assistance route answers with a fixed error code; only these codes
// have a translated explanation. Anything else, including a provider's own
// wording that may travel in an exception message, becomes the generic text
// so nothing untranslated or third-party reaches the screen.
const KNOWN: Record<string, 'aiLimit' | 'aiQuota' | 'aiCredits' | 'aiCap'> = {
  ASSISTANCE_LIMIT: 'aiLimit',
  USAGE_QUOTA_EXCEEDED: 'aiQuota',
  AI_CREDITS_EXHAUSTED: 'aiCredits',
  AI_CAP_REACHED: 'aiCap',
}

export function assistanceErrorMessage(
  code: unknown,
  d: Dictionary['reception'],
): string {
  const key = typeof code === 'string' ? KNOWN[code] : undefined
  return key ? d[key] : d.aiFailed
}

/** Messages the component may show verbatim; every other thrown text is replaced. */
export function assistanceShownMessage(
  thrown: unknown,
  d: Dictionary['reception'],
): string {
  const known = new Set([
    d.aiLimit,
    d.aiQuota,
    d.aiCredits,
    d.aiCap,
    d.aiUnavailable,
  ])
  return thrown instanceof Error && known.has(thrown.message)
    ? thrown.message
    : d.aiFailed
}
