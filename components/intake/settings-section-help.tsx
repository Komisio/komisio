import { CircleHelp } from 'lucide-react'

/** Contextual guidance stays collapsed without hiding the settings themselves. */
export function SettingsSectionHelp({
  label,
  steps,
}: {
  label: string
  steps: string[]
}) {
  return (
    <details className="settings-section-help">
      <summary>
        <CircleHelp size={18} aria-hidden="true" />
        {label}
      </summary>
      <ul>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
    </details>
  )
}
