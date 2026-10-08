import type { Dictionary } from '@/lib/i18n'
import type { SubmissionSuggestion } from '@/lib/assistance/submission-suggestion'
export function SubmissionEstimate({
  output,
  currency,
  d,
}: {
  output: SubmissionSuggestion
  currency: string
  d: Dictionary['submissions']
}) {
  const price = output.price ?? output.externalComparison
  return (
    <aside className="submission-estimate" aria-label={d.assessment}>
      <dl>
        <dt>{d.estimatedPrice}</dt>
        <dd>
          {price ? `${price.from}–${price.to} ${currency}` : d.noEstimate}
        </dd>
      </dl>
      <small>{d.priceNote}</small>
      {output.externalComparison && (
        <>
          <p>
            {output.externalComparison.basis === 'asking'
              ? d.askingComparison
              : d.soldComparison}
          </p>
          <details>
            <summary>{d.priceSources}</summary>
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
          </details>
        </>
      )}
      <p>
        <strong>{d[output.suitability]}</strong>
        <br />
        {output.reason}
      </p>
    </aside>
  )
}
