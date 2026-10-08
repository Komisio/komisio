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
  return (
    <aside className="submission-estimate" aria-label={d.assessment}>
      <dl>
        <dt>{d.estimatedPrice}</dt>
        <dd>
          {output.price
            ? `${output.price.from}–${output.price.to} ${currency}`
            : d.noEstimate}
        </dd>
      </dl>
      <small>{d.priceNote}</small>
      <p>
        <strong>{d[output.suitability]}</strong>
        <br />
        {output.reason}
      </p>
    </aside>
  )
}
