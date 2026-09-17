import type { Dictionary } from '@/lib/i18n'
import type { compareReceptionReview } from '@/lib/engine/reception-review-comparison'

type D = Dictionary['operations']
export function ReceptionComparison({
  comparison,
  d,
}: {
  comparison: ReturnType<typeof compareReceptionReview>
  d: D
}) {
  if (!comparison) return <p>{d.firstPublication}</p>
  const changed =
    comparison.fields.length ||
    comparison.price ||
    comparison.sourceRevisionChanged ||
    comparison.agreementChanged
  return (
    <section aria-label={d.comparisonTitle}>
      <h3>{d.comparisonTitle}</h3>
      <p>
        {d.previousVersion} {comparison.previousVersion}
      </p>
      <p>{d.comparisonNotice}</p>
      {!changed && <p>{d.noComparedChanges}</p>}
      {comparison.sourceRevisionChanged && (
        <p className="intake-notice">{d.sourceVersionChanged}</p>
      )}
      {comparison.agreementChanged && (
        <p className="intake-notice">{d.agreementVersionChanged}</p>
      )}
      {comparison.fields.map((change) => (
        <div className="intake-notice" key={change.field}>
          {/* The dictionary knows the seven fixed fields. A store's own
              attribute is labelled from the vocabulary, not from here, so
              until this screen reads the vocabulary it shows the slug rather
              than nothing. */}
          <strong>
            {(d.fields as Record<string, string | undefined>)[change.field] ??
              change.field}
          </strong>
          <p>
            {d.before}: {change.before?.value ?? d.emptyField}
          </p>
          <small>{change.before?.sourceIds.join(', ')}</small>
          <p>
            {d.after}: {change.after?.value ?? d.emptyField}
          </p>
          <small>{change.after?.sourceIds.join(', ')}</small>
        </div>
      ))}
      {comparison.price && (
        <div className="intake-notice">
          <strong>{d.price}</strong>
          <p>
            {d.before}:{' '}
            {comparison.price.before
              ? `${comparison.price.before.amount} ${comparison.price.before.currency} · ${comparison.price.before.rationale}`
              : d.emptyField}
          </p>
          <small>{comparison.price.before?.sourceIds.join(', ')}</small>
          <p>
            {d.after}:{' '}
            {comparison.price.after
              ? `${comparison.price.after.amount} ${comparison.price.after.currency} · ${comparison.price.after.rationale}`
              : d.emptyField}
          </p>
          <small>{comparison.price.after?.sourceIds.join(', ')}</small>
        </div>
      )}
    </section>
  )
}
