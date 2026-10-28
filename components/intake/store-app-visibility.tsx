'use client'
import { useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { StoreAppVisibility } from '@/lib/engine/store-profile'
import { useIntakeAction } from './use-intake-action'

export function StoreAppVisibilityForm({
  tenantId,
  current,
  editable,
  d,
}: {
  tenantId: string
  current: StoreAppVisibility
  editable: boolean
  d: Dictionary
}) {
  const t = d.storeProfile
  const action = useIntakeAction(d.intake)
  const router = useRouter()
  const [visible, setVisible] = useState(current.visible)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState(false)
  return (
    <section className="card registration-settings" aria-label={t.appTitle}>
      <h2>{t.appTitle}</h2>
      <p id="store-app-hint">{t.appHint}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (action.busy || action.needsReload) return
          if (
            await action.run({
              action: 'setStoreAppVisibility',
              tenantId,
              requestId,
              expectedCurrentId: current.id,
              visible,
            })
          ) {
            setSaved(true)
            setRequestId(crypto.randomUUID())
            router.refresh()
          }
        }}
      >
        <label className="check">
          <input
            type="checkbox"
            checked={visible}
            disabled={!editable || action.locked || action.needsReload}
            aria-describedby="store-app-hint"
            onChange={(e) => {
              setSaved(false)
              setVisible(e.target.checked)
            }}
          />
          {t.appLabel}
        </label>
        {editable && (
          <button
            className="btn btn-secondary"
            disabled={
              action.busy ||
              action.needsReload ||
              (visible === current.visible && !action.locked)
            }
          >
            {t.appSave}
          </button>
        )}
        {action.error && <p role="alert">{action.error}</p>}
        {saved && <p role="status">{t.appSaved}</p>}
        {!editable && <p>{t.readOnly}</p>}
      </form>
    </section>
  )
}
