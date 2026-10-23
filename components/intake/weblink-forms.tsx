'use client'
import { useId, useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useBusyState } from '@/components/platform/work-activity'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { weblinkCommand } from '@/lib/engine/weblink-printers'
import type { PrintDevice } from '@/lib/engine/print-devices'

type Copy = Dictionary['printing']
function useWeblinkWrite() {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [held, setHeld] = useState(false)
  const [done, setDone] = useState(false)
  async function send(input: unknown, terminal = true) {
    if (running.current || held || done) return false
    const c = weblinkCommand.parse(input)
    running.current = true
    setBusy(true)
    try {
      const r = await fetch('/api/print/weblink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      })
      const body = await r.json()
      // Even a 2xx response must confirm this exact command before leaving the form.
      if (!r.ok || body?.ok !== true || body?.id !== c.id)
        throw new Error('UNCONFIRMED')
      setDone(terminal)
      running.current = terminal
      router.refresh()
      return true
    } catch {
      setHeld(true)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, held, done, send }
}
function Outcome({
  held,
  done,
  d,
  reload,
}: {
  held: boolean
  done: boolean
  d: Copy
  reload: string
}) {
  return (
    <>
      {done && <p role="status">{d.weblink.saved}</p>}
      {held && (
        <div role="alert">
          <p>{d.weblink.unconfirmed}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            {reload}
          </Button>
        </div>
      )}
    </>
  )
}
type Common = {
  tenantId: string
  d: Copy
  reload: string
  leaveUnsaved: string
}

export function WeblinkPilot({
  tenantId,
  printerId,
  active,
  devices,
  enabled,
  d,
  reload,
}: Omit<Common, 'leaveUnsaved'> & {
  printerId: string
  active: boolean
  devices: PrintDevice[]
  enabled: boolean
}) {
  const field = useId()
  const action = useWeblinkWrite()
  const router = useRouter()
  const available = devices.filter((device) => !device.revokedAt)
  return (
    <div className="weblink-pilot">
      <p>{active ? d.weblink.pauseHint : d.weblink.pilotHint}</p>
      {active ? (
        <Button
          type="button"
          variant="secondary"
          disabled={action.busy || action.held || action.done}
          onClick={() =>
            action.send({ action: 'pausePilot', tenantId, id: printerId })
          }
        >
          {d.weblink.pause}
        </Button>
      ) : (
        enabled && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.refresh()}
            >
              {d.weblink.refreshDevices}
            </Button>
            {available.length > 0 && (
              <form
                className="printer-form"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const f = new FormData(event.currentTarget)
                  await action.send({
                    action: 'enablePilot',
                    tenantId,
                    id: printerId,
                    deviceId: String(f.get('deviceId')),
                    acknowledged: f.get('acknowledged') === 'on',
                  })
                }}
              >
                <fieldset
                  className="intake-fields"
                  disabled={action.busy || action.held || action.done}
                >
                  <div className="field">
                    <label htmlFor={`${field}-device`}>{d.devicesTitle}</label>
                    <select id={`${field}-device`} name="deviceId" required>
                      {available.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="intake-confirm">
                    <input type="checkbox" name="acknowledged" required />
                    {d.weblink.pilotAcknowledged}
                  </label>
                  <Button type="submit">{d.weblink.enable}</Button>
                </fieldset>
              </form>
            )}
          </>
        )
      )}
      <Outcome {...action} d={d} reload={reload} />
    </div>
  )
}

export function WeblinkSetup({ tenantId, d, reload, leaveUnsaved }: Common) {
  const [id] = useState(() => crypto.randomUUID())
  const field = useId()
  const form = useRef<HTMLFormElement>(null)
  const dirty = useFormDirty(form)
  const action = useWeblinkWrite()
  useUnsavedChanges(dirty.dirty && !action.done ? leaveUnsaved : null)
  return (
    <form
      ref={form}
      className="printer-form"
      onChange={dirty.checkDirty}
      onSubmit={async (event) => {
        event.preventDefault()
        const f = new FormData(event.currentTarget)
        if (
          await action.send({
            action: 'register',
            tenantId,
            id,
            name: String(f.get('name') ?? '').trim(),
            model: String(f.get('model') ?? '').trim(),
            dpi: Number(f.get('dpi')),
          })
        )
          dirty.resetDirty(f)
      }}
    >
      <fieldset
        className="intake-fields"
        data-draft-readiness={!dirty.ready ? '' : undefined}
        disabled={!dirty.ready || action.busy || action.held || action.done}
      >
        <div className="field">
          <label htmlFor={`${field}-name`}>{d.name}</label>
          <input
            id={`${field}-name`}
            name="name"
            required
            pattern=".*\S.*"
            maxLength={80}
          />
        </div>
        <div className="field">
          <label htmlFor={`${field}-model`}>{d.model}</label>
          <input id={`${field}-model`} name="model" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor={`${field}-dpi`}>{d.dpi}</label>
          <select id={`${field}-dpi`} name="dpi" defaultValue="203">
            <option value="203">203</option>
            <option value="300">300</option>
            <option value="600">600</option>
          </select>
        </div>
        <Button type="submit">{d.weblink.register}</Button>
      </fieldset>
      <Outcome {...action} d={d} reload={reload} />
    </form>
  )
}

export function WeblinkRecovery({
  tenantId,
  jobId,
  deviceId,
  revoked,
  d,
  reload,
  leaveUnsaved,
}: Common & { jobId: string; deviceId: string; revoked: boolean }) {
  const field = useId()
  const form = useRef<HTMLFormElement>(null)
  const dirty = useFormDirty(form)
  const action = useWeblinkWrite()
  useUnsavedChanges(dirty.dirty && !action.done ? leaveUnsaved : null)
  return (
    <details>
      <summary>{d.weblink.recovery}</summary>
      <p>{d.weblink.recoveryHint}</p>
      {!revoked && (
        <Button
          type="button"
          variant="danger"
          disabled={action.busy || action.held}
          onClick={() =>
            action.send({ action: 'revoke', tenantId, id: deviceId }, false)
          }
        >
          {d.weblink.revoke}
        </Button>
      )}
      {revoked && <p>{d.revoked}</p>}
      <form
        ref={form}
        className="printer-form"
        onChange={dirty.checkDirty}
        onSubmit={async (event) => {
          event.preventDefault()
          const f = new FormData(event.currentTarget)
          if (
            await action.send({
              action: 'resolve',
              tenantId,
              id: jobId,
              resolution: String(f.get('resolution')),
              note: String(f.get('note') ?? '').trim(),
              inspected: f.get('inspected') === 'on',
            })
          )
            dirty.resetDirty(f)
        }}
      >
        <fieldset
          className="intake-fields"
          data-draft-readiness={!dirty.ready ? '' : undefined}
          disabled={
            !dirty.ready ||
            !revoked ||
            action.busy ||
            action.held ||
            action.done
          }
        >
          <label className="intake-confirm">
            <input type="checkbox" name="inspected" required />
            {d.weblink.inspected}
          </label>
          <div className="field">
            <label htmlFor={`${field}-note`}>{d.weblink.note}</label>
            <textarea
              id={`${field}-note`}
              name="note"
              required
              maxLength={500}
              onChange={(e) =>
                e.currentTarget.setCustomValidity(
                  e.currentTarget.value.trim() ? '' : d.weblink.note,
                )
              }
            />
          </div>
          <div
            className="field"
            role="group"
            aria-labelledby={`${field}-resolution`}
          >
            <p id={`${field}-resolution`}>{d.weblink.result}</p>
            <label className="intake-confirm">
              <input type="radio" name="resolution" value="printed" required />
              {d.weblink.printed}
            </label>
            <label className="intake-confirm">
              <input
                type="radio"
                name="resolution"
                value="cancelled"
                required
              />
              {d.weblink.cancelled}
            </label>
          </div>
          <Button type="submit">{d.weblink.resolve}</Button>
        </fieldset>
        <Outcome {...action} d={d} reload={reload} />
      </form>
    </details>
  )
}
