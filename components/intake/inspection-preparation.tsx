import type { Dictionary } from '@/lib/i18n'
import type { InspectionReceptionPreparation } from '@/lib/engine/inspection-reception-preview'

export function InspectionPreparation({
  preview,
  d,
}: {
  preview: InspectionReceptionPreparation
  d: Dictionary
}) {
  const s = d.inspection.preparation
  return (
    <details className="card intake-form inspection-preparation">
      <summary>{s.title}</summary>
      <p>{s.notice}</p>
      <p>
        {d.inspection.version} {preview.origin.revision}. {s.savedOnly}
      </p>
      <h3>{s.candidates}</h3>
      <dl>
        {preview.candidates.map((c) => (
          <div key={c.field}>
            <dt>{d.inspection[c.field]}</dt>
            <dd>{c.value}</dd>
          </div>
        ))}
      </dl>
      <p>{s.unverified}</p>
      <h3>{s.next}</h3>
      <ol>
        {preview.stepsToCheck.map((step) => (
          <li key={step}>{s.steps[step]}</li>
        ))}
      </ol>
      <p>{s.notChecked}</p>
    </details>
  )
}
