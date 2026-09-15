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
  return (
    <div>
      <h3>{d.formatsHeading}</h3>
      <p>{d.formatsIntro}</p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{d.formatKind}</th>
              <th>{d.width}</th>
              <th>{d.height}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
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
          </tbody>
        </table>
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
  async function save() {
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
    <tr>
      <td>
        {d.kinds[kind]}
        {!format.custom && <small> · {d.defaultSize}</small>}
      </td>
      <td>
        <label className="sr-only" htmlFor={`w-${id}`}>
          {d.width}
        </label>
        <input
          id={`w-${id}`}
          inputMode="decimal"
          value={width}
          disabled={!canEdit || action.busy}
          onChange={(e) => setWidth(e.target.value)}
          style={{ width: '5em' }}
        />
      </td>
      <td>
        <label className="sr-only" htmlFor={`h-${id}`}>
          {d.height}
        </label>
        <input
          id={`h-${id}`}
          inputMode="decimal"
          value={height}
          disabled={!canEdit || action.busy}
          onChange={(e) => setHeight(e.target.value)}
          style={{ width: '5em' }}
        />
      </td>
      <td>
        {canEdit && (
          <Button
            variant="secondary"
            disabled={action.busy || action.needsReload}
            onClick={() => void save()}
          >
            {action.busy ? intake.busy : d.saveFormat}
          </Button>
        )}
        {(invalid || action.error) && (
          <span role="alert"> {invalid ? d.formatInvalid : action.error}</span>
        )}
        {saved && <span role="status"> {d.formatSaved}</span>}
      </td>
    </tr>
  )
}
