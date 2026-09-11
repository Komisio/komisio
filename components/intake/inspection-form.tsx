'use client'
import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { SavedInspection } from '@/lib/engine/inspection'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

export function InspectionForm({
  tenantId,
  bagId,
  current,
  d,
}: {
  tenantId: string
  bagId: string
  current: SavedInspection | null
  d: Dictionary
}) {
  const [base] = useState(current)
  const router = useRouter()
  // SSR fields must not accept edits before React attaches change/save handlers.
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [draftId] = useState(() => current?.draft_id ?? crypto.randomUUID())
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const action = useIntakeAction(d.intake)
  const s = d.inspection
  const path = `/intake/bags/${bagId}/inspect`
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const result = await action.run({
      action: 'saveInspection',
      tenantId,
      requestId: crypto.randomUUID(),
      bagId,
      draftId,
      expectedRevision: base?.revision ?? 0,
      fields: {
        description: values.get('description'),
        category: values.get('category'),
        condition: values.get('condition'),
      },
    })
    if (result) {
      setSaved(true)
      setDirty(false)
      router.refresh()
    }
  }
  if (saved)
    return (
      <section className="card intake-form" role="status">
        <h2>{s.saved}</h2>
        <p>{s.savedHint}</p>
        <a className="text-link" href={`${path}?draft=${draftId}`}>
          {s.resume}
        </a>
        <a className="text-link" href={path}>
          {s.another}
        </a>
      </section>
    )
  return (
    <section className="card intake-form">
      <h2>{base ? s.edit : s.add}</h2>
      <p>
        {dirty ? s.unsaved : base ? `${s.version} ${base.revision}` : s.newHint}
      </p>
      <p>{s.saveHint}</p>
      <form onSubmit={submit} onChange={() => setDirty(true)}>
        <fieldset
          className="intake-fields"
          disabled={!ready || action.busy || action.locked}
        >
          <div className="field">
            <label htmlFor="item-description">{s.description}</label>
            <textarea
              id="item-description"
              name="description"
              rows={3}
              required
              maxLength={1000}
              defaultValue={base?.description ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="item-category">{s.category}</label>
            <input
              id="item-category"
              name="category"
              maxLength={120}
              defaultValue={base?.category ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="item-condition">{s.condition}</label>
            <textarea
              id="item-condition"
              name="condition"
              rows={3}
              maxLength={500}
              defaultValue={base?.condition ?? ''}
            />
          </div>
        </fieldset>
        {action.error && (
          <p role="alert" className="form-error">
            {action.error}
          </p>
        )}
        {action.needsReload && (
          <p>
            <a
              className="text-link"
              href={base ? `${path}?draft=${draftId}` : path}
            >
              {s.reload}
            </a>
          </p>
        )}
        <Button
          disabled={!ready || action.busy || action.needsReload}
          type="submit"
        >
          {action.busy ? d.intake.busy : s.save}
        </Button>
      </form>
    </section>
  )
}
