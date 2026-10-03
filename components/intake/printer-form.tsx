'use client'
import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { registerPrinterCommand } from '@/lib/engine/printing'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

/** Owner or admin registers or updates a store printer. */
export function PrinterForm({
  tenantId,
  existing,
  d,
  intake,
  leaveUnsaved,
}: {
  tenantId: string
  existing?: {
    id: string
    name: string
    transport: 'tcp' | 'usb'
    address: string
    model: string
    dpi: number
    active: boolean
  }
  d: Dictionary['printing']
  intake: Dictionary['intake']
  leaveUnsaved: string
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const fieldId = useId()
  const [requestId] = useState(() => existing?.id ?? crypto.randomUUID())
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(form)
  useUnsavedChanges(dirty || action.locked ? leaveUnsaved : null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The command ID is the printer ID, not a replay token: an uncertain
    // upsert must be inspected before another write can replace newer edits.
    if (action.busy || action.locked || action.needsReload) return
    setSaved(false)
    const f = new FormData(event.currentTarget)
    const candidate = registerPrinterCommand.safeParse({
      action: 'registerPrinter',
      tenantId,
      requestId,
      name: String(f.get('name') ?? ''),
      transport: String(f.get('transport') ?? 'tcp'),
      address: String(f.get('address') ?? ''),
      model: String(f.get('model') ?? ''),
      dpi: Number(f.get('dpi') ?? 203),
      active: f.get('active') === 'on',
    })
    setInvalid(!candidate.success)
    if (!candidate.success) return
    if (await action.run(candidate.data)) {
      setSaved(true)
      resetDirty(f)
      router.refresh()
    }
  }
  return (
    <form
      ref={form}
      onSubmit={submit}
      onChange={() => {
        setSaved(false)
        checkDirty()
      }}
    >
      <fieldset
        data-draft-readiness={!ready ? '' : undefined}
        className="intake-fields"
        disabled={!ready || action.busy || action.locked || action.needsReload}
      >
        <div className="field">
          <label htmlFor={`printer-name-${fieldId}`}>{d.name}</label>
          <input
            id={`printer-name-${fieldId}`}
            name="name"
            required
            maxLength={80}
            defaultValue={existing?.name ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor={`printer-transport-${fieldId}`}>{d.transport}</label>
          <select
            id={`printer-transport-${fieldId}`}
            name="transport"
            defaultValue={existing?.transport ?? 'tcp'}
          >
            <option value="tcp">{d.tcp}</option>
            <option value="usb">{d.usb}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`printer-address-${fieldId}`}>{d.address}</label>
          <input
            id={`printer-address-${fieldId}`}
            name="address"
            maxLength={200}
            placeholder="192.168.1.50:9100"
            defaultValue={existing?.address ?? ''}
          />
          <small>{d.addressHint}</small>
        </div>
        <div className="field">
          <label htmlFor={`printer-model-${fieldId}`}>{d.model}</label>
          <input
            id={`printer-model-${fieldId}`}
            name="model"
            maxLength={80}
            defaultValue={existing?.model ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor={`printer-dpi-${fieldId}`}>{d.dpi}</label>
          <select
            id={`printer-dpi-${fieldId}`}
            name="dpi"
            defaultValue={String(existing?.dpi ?? 203)}
          >
            <option value="203">203</option>
            <option value="300">300</option>
            <option value="600">600</option>
          </select>
        </div>
        <label className="intake-confirm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={existing?.active ?? true}
          />
          {d.active}
        </label>
      </fieldset>
      {(invalid || action.error) && (
        <p role="alert">
          {invalid
            ? intake.invalid
            : action.locked && action.error === intake.failed
              ? d.printerUncertain
              : action.error}
        </p>
      )}
      {!action.busy && (action.locked || action.needsReload) && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => location.reload()}
        >
          {intake.reload}
        </Button>
      )}
      <Button
        type="submit"
        disabled={!ready || action.busy || action.locked || action.needsReload}
      >
        {action.busy ? intake.busy : existing ? d.update : d.register}
      </Button>
      {saved && <p role="status">{d.saved}</p>}
    </form>
  )
}
