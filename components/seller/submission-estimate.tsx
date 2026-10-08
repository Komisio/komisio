import { intlLocale, type Dictionary, type Locale } from '@/lib/i18n'
import type { SubmissionSuggestion } from '@/lib/assistance/submission-suggestion'
export function SubmissionEstimate({
  output,
  currency,
  locale,
  pricing = 'store',
  staff = false,
  d,
}: {
  output: SubmissionSuggestion
  currency: string
  locale: Locale
  pricing?: 'store' | 'seller' | 'approval'
  staff?: boolean
  d: Dictionary['submissions']
}) {
  const format = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const price =
    output.price ?? output.externalComparison ?? output.approximatePrice
  return (
    <aside className="submission-estimate" aria-label={d.assessment}>
      <dl>
        <dt>{d.estimatedPrice}</dt>
        <dd>
          {output.indicativePrice
            ? d.indicativePrice.replace(
                '{price}',
                format.format(Number(output.indicativePrice)),
              )
            : price
              ? format.formatRange(Number(price.from), Number(price.to))
              : d.noEstimate}
        </dd>
      </dl>
      <small>
        {!output.price &&
          !output.externalComparison &&
          output.approximatePrice && <>{d.approximateOnly} </>}
        {staff
          ? d.pricingModes[pricing]
          : pricing === 'store'
            ? d.storePriceNote
            : pricing === 'seller'
              ? d.sellerPriceNote
              : d.approvalPriceNote}
      </small>
      {price && (
        <details>
          <summary>{d.priceSources}</summary>
          <p>
            {d.priceRange}:{' '}
            {format.formatRange(Number(price.from), Number(price.to))}
          </p>
          {output.externalComparison && (
            <>
              <p>
                {output.externalComparison.basis === 'asking'
                  ? d.askingComparison
                  : d.soldComparison}
              </p>
              <ul>
                {output.externalComparison.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title}
                    </a>
                    {' · '}
                    {source.amount} SEK
                  </li>
                ))}
              </ul>
              <small>
                {d.sourcesChecked}{' '}
                {output.externalComparison.observedAt.slice(0, 10)}
              </small>
            </>
          )}
        </details>
      )}
      <p>
        {!staff && output.suitability === 'uncertain' ? (
          d.storeAssessment
        ) : (
          <>
            <strong>{d[output.suitability]}</strong>
            <br />
            {output.reason}
          </>
        )}
      </p>
    </aside>
  )
}
