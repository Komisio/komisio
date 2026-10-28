'use client'
import { useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { StoreAppVisibility } from '@/lib/engine/store-profile'
import { useIntakeAction } from './use-intake-action'

/**
 * The checkbox draft and the version it was edited against. Only a newer
 * version replaces an unedited draft: props from before a confirmed save are
 * older than the saved version and are ignored until the refresh catches up.
 * An edited or in-flight draft keeps its version, so saving it against a
 * newer change is refused as stale instead of being silently rebased.
 */
export type VisibilityDraft = {
  baseId: string | null
  baseVersion: number
  baseVisible: boolean
  visible: boolean
}
export function initialVisibilityDraft(
  current: StoreAppVisibility,
): VisibilityDraft {
  return {
    baseId: current.id,
    baseVersion: current.version,
    baseVisible: current.visible,
    visible: current.visible,
  }
}
export function syncVisibilityDraft(
  draft: VisibilityDraft,
  current: StoreAppVisibility,
  locked: boolean,
): VisibilityDraft {
  if (
    locked ||
    draft.visible !== draft.baseVisible ||
    current.version <= draft.baseVersion
  )
    return draft
  return initialVisibilityDraft(current)
}
/** A confirmed save is the next version, and the request id is its id. */
export function savedVisibilityDraft(
  draft: VisibilityDraft,
  requestId: string,
): VisibilityDraft {
  return {
    baseId: requestId,
    baseVersion: draft.baseVersion + 1,
    baseVisible: draft.visible,
    visible: draft.visible,
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
  const [draft, setDraft] = useState(() => initialVisibilityDraft(current))
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
              expectedCurrentId: synced.baseId,
              visible,
            })
          ) {
            setDraft(savedVisibilityDraft(synced, requestId))
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
