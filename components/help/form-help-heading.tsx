'use client'
import { useId, useState } from 'react'
import { CircleHelp } from 'lucide-react'

/** A short disclosure for this form only; opening it never navigates or submits. */
export function FormHelpHeading({
  title,
  level = 2,
  help,
}: {
  title: string
  level?: 1 | 2
  help: { label: string; steps: string[] }
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className="form-help-heading">
      <div className="form-help-title">
        <Heading>{title}</Heading>
        <button
          type="button"
          className="form-help-toggle"
          aria-label={help.label}
          title={help.label}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <CircleHelp size={20} aria-hidden="true" />
        </button>
      </div>
      <div id={id} hidden={!open} className="form-help-content">
        <ul>
          {help.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
