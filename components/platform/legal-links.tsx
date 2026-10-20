import type { Dictionary } from '@/lib/i18n'
import { legalUrl, type LegalPage } from '@/lib/platform/legal'

/** Document navigation only: no acceptance statement or consent collection. */
export function LegalLinks({
  locale,
  baseUrl,
  d,
  pricing = false,
}: {
  locale: string
  baseUrl?: string
  d: Dictionary['legal']
  pricing?: boolean
}) {
  const pages: LegalPage[] = pricing
    ? ['pricing', 'terms']
    : ['terms', 'privacy', 'dpa']
  if (!legalUrl(locale, 'terms', baseUrl)) return null
  return (
    <nav className="legal-links" aria-label={pricing ? d.purchase : d.title}>
      {pages.map((page) => (
        <a
          key={page}
          href={legalUrl(locale, page, baseUrl)!}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${d[page]} (${d.newTab})`}
        >
          {d[page]}
        </a>
      ))}
    </nav>
  )
}
