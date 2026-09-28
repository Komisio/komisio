'use client'
import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { setLabelFormatCommand, type LabelFormats } from '@/lib/engine/printing'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Owner or admin sets the label size per kind; a default applies until then. */
export function LabelFormatsForm({
  tenantId,
  formats,
  canEdit,
  d,
  intake,
}: {
  tenantId: string
  formats: LabelFormats
  canEdit: boolean
  d: Dictionary['printing']
  intake: Dictionary['intake']
}) {
  const kinds = ['bag', 'garment', 'item', 'markdown', 'onboarding'] as const
  // One group per label kind rather than a table: on a phone the kind, both
  // sizes, the action and any message stack within the viewport instead of
  // scrolling sideways; on a desktop the same groups lay out as rows.
  return (
    <div>
      <h3>{d.formatsHeading}</h3>
      <p>{d.formatsIntro}</p>
      <div className="label-formats">
        {kinds.map((kind) => (
          <FormatRow
            key={kind}
            tenantId={tenantId}
            kind={kind}
            format={formats[kind]}
            canEdit={canEdit}
            d={d}
            intake={intake}
          />
        ))}
      </div>
    </div>
  )
}

function FormatRow({
  tenantId,
  kind,
  format,
  canEdit,
  d,
  intake,
}: {
  tenantId: string
  kind: 'bag' | 'garment' | 'item' | 'markdown' | 'onboarding'
  format: { widthMm: number; heightMm: number; custom: boolean }
  canEdit: boolean
  d: Dictionary['printing']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const id = useId()
  const [width, setWidth] = useState(String(format.widthMm))
  const [height, setHeight] = useState(String(format.heightMm))
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  // This mutable setting has no replay identity. Inspect current dimensions
  // after an uncertain save before another write can replace a later edit.
  const frozen = action.busy || action.locked || action.needsReload
  async function save() {
    if (!canEdit || frozen) return
    setSaved(false)
    const candidate = setLabelFormatCommand.safeParse({
      action: 'setLabelFormat',
      tenantId,
      requestId: crypto.randomUUID(),
      kind,
      widthMm: Number(width.replace(',', '.')),
      heightMm: Number(height.replace(',', '.')),
    })
    setInvalid(!candidate.success)
    if (!candidate.success) return
    if (await action.run(candidate.data)) {
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <div className="label-format" role="group" aria-labelledby={`k-${id}`}>
      <div className="label-format-kind" id={`k-${id}`}>
        {d.kinds[kind]}
        {!format.custom && <small> · {d.defaultSize}</small>}
      </div>
      <div className="label-format-size">
        <label htmlFor={`w-${id}`}>{d.width}</label>
        <input
          id={`w-${id}`}
          inputMode="decimal"
          value={width}
          disabled={!canEdit || frozen}
          onChange={(e) => setWidth(e.target.value)}
        />
      </div>
      <div className="label-format-size">
        <label htmlFor={`h-${id}`}>{d.height}</label>
        <input
          id={`h-${id}`}
          inputMode="decimal"
          value={height}
          disabled={!canEdit || frozen}
          onChange={(e) => setHeight(e.target.value)}
        />
      </div>
      {canEdit && (
        <div className="label-format-actions row wrap">
          <Button
            variant="secondary"
            disabled={frozen}
            onClick={() => void save()}
          >
            {action.busy ? intake.busy : d.saveFormat}
          </Button>
          {!action.busy && (action.locked || action.needsReload) && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {intake.reload}
            </Button>
          )}
        </div>
      )}
      {(invalid || action.error) && (
        <p role="alert" className="label-format-message error">
          {invalid
            ? d.formatInvalid
            : action.locked && action.error === intake.failed
              ? d.formatUncertain
              : action.error}
        </p>
      )}
      {saved && (
        <p role="status" className="label-format-message">
          {d.formatSaved}
        </p>
      )}
    </div>
  )
}
