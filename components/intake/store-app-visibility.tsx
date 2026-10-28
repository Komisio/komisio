'use client'
import { useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { StoreAppVisibility } from '@/lib/engine/store-profile'
import { useIntakeAction } from './use-intake-action'

/**
 * The checkbox draft and the version it was edited against. A refresh that
 * brings a newer version replaces an unedited draft; an edited one keeps its
 * original version, so saving it is refused as stale instead of being
 * silently applied on top of someone else's change.
 */
export type VisibilityDraft = {
  base: string | null
  baseVisible: boolean
  visible: boolean
}
export function syncVisibilityDraft(
  draft: VisibilityDraft,
  current: StoreAppVisibility,
  locked: boolean,
): VisibilityDraft {
  if (
    draft.base === current.id ||
    locked ||
    draft.visible !== draft.baseVisible
  )
    return draft
  return {
    base: current.id,
    baseVisible: current.visible,
    visible: current.visible,
  }
}

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
  const [draft, setDraft] = useState<VisibilityDraft>(() => ({
    base: current.id,
    baseVisible: current.visible,
    visible: current.visible,
  }))
  const synced = syncVisibilityDraft(draft, current, action.locked)
  if (synced !== draft) setDraft(synced)
  const visible = synced.visible
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
              expectedCurrentId: synced.base,
              visible,
            })
          ) {
            // The saved row's id is the request id: the refreshed version.
            setDraft({ base: requestId, baseVisible: visible, visible })
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
              setDraft({ ...synced, visible: e.target.checked })
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
              (visible === synced.baseVisible && !action.locked)
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
