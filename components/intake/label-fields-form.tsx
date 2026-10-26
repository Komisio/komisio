'use client'
import { useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import type { Dictionary } from '@/lib/i18n'
import {
  setItemLabelFieldsCommand,
  type ItemLabelFields,
} from '@/lib/engine/label-fields'
import { useIntakeAction } from './use-intake-action'

export function LabelFieldsForm({
  tenantId,
  settings,
  choices,
  canEdit,
  d,
}: {
  tenantId: string
  settings: ItemLabelFields
  choices: { value: string; label: string }[]
  canEdit: boolean
  d: Dictionary
}) {
  const copy = d.labelFields
  const action = useIntakeAction(d.intake)
  const router = useRouter()
  const [custom, setCustom] = useState(settings.fields !== null)
  const [selected, setSelected] = useState(
    Array.from({ length: 4 }, (_, i) => settings.fields?.[i] ?? ''),
  )
  const [baseline, setBaseline] = useState(settings)
  const [saved, setSaved] = useState(false)
  const value = custom ? selected.filter(Boolean) : null
  const dirty = JSON.stringify(value) !== JSON.stringify(baseline.fields)
  const locked = !canEdit || action.busy || action.locked || action.needsReload
  const invalid = custom && new Set(value).size !== value!.length
  useUnsavedChanges(
    canEdit && !saved && (dirty || action.locked) ? d.leaveUnsaved : null,
  )
  async function save() {
    if (!canEdit || action.busy || action.needsReload || invalid) return
    const command = setItemLabelFieldsCommand.safeParse({
      action: 'setItemLabelFields',
      tenantId,
      requestId: crypto.randomUUID(),
      expectedRevision: baseline.revision,
      fields: value,
    })
    if (!command.success) return
    if (await action.run(command.data)) {
      setBaseline({ revision: baseline.revision + 1, fields: value })
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <details className="label-formats-fold label-fields-form">
      <summary>{copy.title}</summary>
      <p>{copy.hint}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={locked} className="grid gap-4">
          <legend className="sr-only">{copy.title}</legend>
          <label className="row">
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => {
                setCustom(e.target.checked)
                setSaved(false)
              }}
            />
            {copy.custom}
          </label>
          {!custom && <p>{copy.default}</p>}
          {custom &&
            selected.map((slug, index) => (
              <label key={index} className="grid gap-1">
                {copy.field.replace('{number}', String(index + 1))}
                <select
                  value={slug}
                  onChange={(e) => {
                    setSelected(
                      selected.map((v, i) =>
                        i === index ? e.target.value : v,
                      ),
                    )
                    setSaved(false)
                  }}
                >
                  <option value="">{copy.none}</option>
                  {slug && !choices.some((c) => c.value === slug) && (
                    <option value={slug}>{slug}</option>
                  )}
                  {choices.map((c) => (
                    <option
                      key={c.value}
                      value={c.value}
                      disabled={selected.some(
                        (v, i) => i !== index && v === c.value,
                      )}
                    >
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </fieldset>
        {invalid && <p role="alert">{d.intake.invalid}</p>}
        {canEdit && !saved && !action.locked && !action.needsReload && (
          <button
            className="btn btn-primary"
            disabled={!dirty || invalid || action.busy}
            type="submit"
          >
            {copy.save}
          </button>
        )}
        {saved && <p role="status">{copy.saved}</p>}
        {action.error && <p role="alert">{action.error}</p>}
        {action.needsReload ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            {d.intake.reload}
          </button>
        ) : action.locked && !action.busy ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void save()}
          >
            {d.intake.retry}
          </button>
        ) : null}
      </form>
    </details>
  )
}
