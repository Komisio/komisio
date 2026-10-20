import { isLocale } from '../i18n'

export const legalPages = ['terms', 'privacy', 'dpa', 'pricing'] as const
export type LegalPage = (typeof legalPages)[number]

/** Validate on the server before serializing the public base into client props. */
export function legalBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) return undefined
  try {
    const url = new URL(baseUrl.trim())
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Operator-owned documents; unset/invalid configuration never implies Komisio terms. */
export function legalUrl(
  locale: unknown,
  page: LegalPage,
  baseUrl?: string,
): string | null {
  const base = legalBaseUrl(baseUrl)
  if (!base || !legalPages.includes(page)) return null
  const url = new URL(base)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${isLocale(locale) ? locale : 'en'}/${page}/`
  return url.href
}
