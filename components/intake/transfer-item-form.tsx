'use client'
import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Moves one consignment item to another store in the chain: ends it here, receives it there. */
export function TransferItemForm({
  tenantId,
  itemId,
  stores,
  d,
  intake,
}: {
  tenantId: string
  itemId: string
  stores: { id: string; name: string }[]
  d: Dictionary['items']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const requestId = useRef<string | null>(null)
  const targetName = useRef('')
  const [done, setDone] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    requestId.current ??= crypto.randomUUID()
    const target = String(f.get('target'))
    // Locked fields are omitted from FormData; a retry uses the hook's saved
    // command and must keep the destination that command actually targeted.
    if (!action.locked)
      targetName.current = stores.find((s) => s.id === target)?.name ?? target
    const result = await action.run({
      action: 'transferItem',
      tenantId,
      requestId: requestId.current,
      itemId,
      toTenantId: target,
      note: String(f.get('note') ?? ''),
    })
    if (result) setDone(targetName.current)
  }
  if (done)
    return <p role="status">{d.transferDone.replace('{store}', done)}</p>
  return (
    <form onSubmit={submit}>
      <p>{d.transferHint}</p>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || action.needsReload}
      >
        <div className="field">
          <label htmlFor="transfer-target">{d.transferTarget}</label>
          <select id="transfer-target" name="target" required>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="transfer-note">{d.transferNote}</label>
          <input id="transfer-note" name="note" maxLength={500} />
        </div>
      </fieldset>
      <Button variant="secondary" disabled={action.busy || action.needsReload}>
        {action.busy
          ? intake.busy
          : action.locked && !action.needsReload
            ? intake.retry
            : d.transfer}
      </Button>
      {action.error && <p role="alert">{action.error}</p>}
      {action.needsReload && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {intake.reload}
        </Button>
      )}
    </form>
  )
}
