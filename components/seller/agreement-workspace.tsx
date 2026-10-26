import type { z } from 'zod'
import { EventTime } from '@/components/ui/event-time'
import { AgreementAcceptance } from './agreement-acceptance'
import { dictionary, intlLocale, localeNames, type Locale } from '@/lib/i18n'
import type {
  sellerAgreementArchive,
  sellerTermsSummary,
} from '@/lib/engine/seller-agreement'

export function SellerAgreementWorkspace({
  tenantId,
  sellerId,
  storeName,
  locale,
  state,
  summary,
  page,
  base,
}: {
  tenantId: string
  sellerId: string
  storeName: string
  locale: Locale
  state: z.infer<typeof sellerAgreementArchive>
  summary: z.infer<typeof sellerTermsSummary>
  page: number
  base: string
}) {
  const d = dictionary(locale),
    copy = d.sellerAgreementSummary,
    agreement = state.agreement
  if (!agreement)
    return (
      <section className="card">
        <p>{d.sellerPortalWorkspace.noAgreement}</p>
      </section>
    )
  // Re-read legal text and evidence on version/language navigation; cached
  // client navigation can restore a stale version or duplicate its fragment.
  const href = (
    version: string | null,
    targetPage = page,
    text: string | null = null,
  ) => {
    const q = new URLSearchParams(base.split('?')[1])
    if (version) q.set('agreementVersion', version)
    if (targetPage > 1) q.set('agreementPage', String(targetPage))
    if (text) q.set('agreementText', text)
    return '/seller?' + q + '#seller-workspace-agreement'
  }
  const number = (value: number) =>
    new Intl.NumberFormat(intlLocale(locale)).format(value)
  const pages = Math.max(1, Math.ceil(state.total / 20))
  return (
    <>
      <article className="card seller-agreement-workspace">
        <h2>{agreement.title}</h2>
        <p>
          {storeName} · {d.agreements.usage.sellerName}:{' '}
          <strong>{summary.sellerName}</strong>
        </p>
        <p>
          {d.agreements.version} {agreement.version}
          {!state.current && <> · {d.sellerAgreement.previousVersion}</>}
        </p>
        {!state.current && (
          <p>
            <a href={href(null)}>{d.sellerAgreement.currentVersion}</a>
          </p>
        )}
        {state.current && (
          <section aria-label={copy.summary}>
            <h3>{copy.summary}</h3>
            <p className="muted">{copy.currentSettings}</p>
            <ul>
              <li>
                {copy.commission
                  .replace('{rate}', number(summary.commissionRatePercent))
                  .replace('{basis}', d.sellerTerms[summary.commissionBasis])}
              </li>
              <li>
                {summary.months
                  ? copy.months.replace('{months}', number(summary.months))
                  : copy.days.replace('{days}', number(summary.salePeriodDays))}
              </li>
              <li>
                {summary.collectionDays !== null
                  ? copy.collection.replace(
                      '{days}',
                      number(summary.collectionDays ?? 0),
                    )
                  : copy[summary.endOfPeriodAction]}
              </li>
            </ul>
          </section>
        )}
        {state.languages.length > 1 && (
          <nav className="row wrap" aria-label={d.agreements.language}>
            {state.languages.map((language) => (
              <a
                key={language.id}
                href={href(agreement.id, page, language.id)}
                aria-current={
                  language.id === (agreement.translationId ?? agreement.id)
                    ? 'page'
                    : undefined
                }
              >
                {localeNames[language.language]}
              </a>
            ))}
          </nav>
        )}
        <details
          className="seller-portal-fold"
          data-testid="seller-agreement-full"
        >
          <summary>{copy.fullText}</summary>
          <p>
            {d.agreements.language}: {localeNames[agreement.language]}
          </p>
          <div
            className="seller-agreement-body"
            lang={intlLocale(agreement.language)}
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {agreement.body}
          </div>
        </details>
        {state.acceptance ? (
          <p role="status">
            {state.acceptance.source === 'seller_portal'
              ? d.sellerAgreement.accepted
              : d.sellerAgreement.recorded}{' '}
            ·{' '}
            {state.acceptance.language && (
              <>{localeNames[state.acceptance.language]} · </>
            )}
            <EventTime value={state.acceptance.at} locale={locale} />
          </p>
        ) : state.current ? (
          <AgreementAcceptance
            key={`${agreement.id}:${agreement.translationId ?? 'base'}`}
            tenantId={tenantId}
            sellerId={sellerId}
            agreementId={agreement.id}
            translationId={agreement.translationId}
            d={d}
          />
        ) : null}
      </article>
      {state.total > 0 && (
        <details
          className="card no-print"
          open={page > 1}
          data-testid="seller-agreement-history"
        >
          <summary>{d.sellerAgreement.history}</summary>
          <ul>
            {state.history.map((entry) => (
              <li key={entry.id} style={{ paddingBlock: '0.5rem' }}>
                <a
                  href={href(entry.id)}
                  aria-current={entry.id === agreement.id ? 'page' : undefined}
                >
                  {d.agreements.version} {entry.version} · {entry.title}
                </a>
                <div className="muted">
                  <EventTime value={entry.at} locale={locale} />
                </div>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className="row wrap" aria-label={d.sellerAgreement.history}>
              {page > 1 && (
                <a href={href(state.current ? null : agreement.id, page - 1)}>
                  {d.submissions.previous}
                </a>
              )}
              <span>
                {page} / {pages}
              </span>
              {page < pages && (
                <a href={href(state.current ? null : agreement.id, page + 1)}>
                  {d.submissions.next}
                </a>
              )}
            </nav>
          )}
        </details>
      )}
    </>
  )
}
