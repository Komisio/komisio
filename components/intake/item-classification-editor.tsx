'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import { classificationCommand } from '@/lib/engine/item-classification'
import { labelOf, type ItemTypeProfile } from '@/lib/engine/attributes'
import type { Dictionary, Locale } from '@/lib/i18n'
import { NavigationLink } from '@/components/platform/navigation-warning'
export function ItemClassificationEditor({
  tenantId,
  items,
  groups,
  types,
  locale,
  manage,
  d,
  onLockedChange,
  onSaved,
}: {
  tenantId: string
  items: { id: string; version: number; title: string }[]
  groups: { id: string; name: string }[]
  types: ItemTypeProfile[]
  locale: Locale
  manage: boolean
  d: Dictionary
  onLockedChange?: (locked: boolean) => void
  onSaved?: () => void
}) {
  const t = d.itemWorkflow,
    router = useRouter(),
    [busy, setBusy] = useBusyState(false),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false),
    [status, setStatus] = useState('')
  const [kind, setKind] = useState(''),
    [group, setGroup] = useState('')
  const pending = useRef<ReturnType<typeof classificationCommand.parse> | null>(
      null,
    ),
    running = useRef(false)
  async function send() {
    if (running.current || refused) return
    const parsed = classificationCommand.safeParse(
      pending.current ?? {
        action: 'classify',
        tenantId,
        requestId: crypto.randomUUID(),
        items: items.map(({ id, version }) => ({ id, version })),
        itemType: kind === 'none' ? null : kind,
        assortment: group === 'none' ? null : group,
      },
    )
    if (!parsed.success) return
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setLocked(true)
    onLockedChange?.(true)
    setStatus('')
    try {
      const response = await fetch('/api/items/classification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = await response.json()
      if (
        response.ok &&
        body.ok === true &&
        body.id === parsed.data.requestId
      ) {
        pending.current = null
        setLocked(false)
        onLockedChange?.(false)
        setStatus(t.saved)
        router.refresh()
        if (parsed.data.action === 'classify') onSaved?.()
      } else if (response.status >= 400 && response.status < 500) {
        setRefused(true)
        onLockedChange?.(false)
        setStatus(t.changed)
      } else setStatus(t.uncertain)
    } catch {
      setStatus(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <p>{t.bulkHint}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <fieldset disabled={locked || busy}>
          <div className="row wrap" style={{ alignItems: 'end' }}>
            <label>
              {d.quickIntake.itemType}
              <select
                aria-label={d.quickIntake.itemType}
                required
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">{t.choose}</option>
                <option value="none">{t.none}</option>
                {types
                  .filter((t) => t.active)
                  .map((type) => (
                    <option key={type.slug} value={type.slug}>
                      {labelOf(type, locale)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t.group}
              <select
                aria-label={t.group}
                required
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">{t.choose}</option>
                <option value="none">{t.none}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <button
          className="btn btn-primary"
          disabled={busy || refused || !items.length}
        >
          {t.save}
        </button>
      </form>
      {manage && (
        <p>
          <NavigationLink href="/settings?tab=vocabulary#vocabulary-groups">
            {d.vocabularySettings.manageGroups}
          </NavigationLink>
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {refused && (
        <button
          className="btn btn-secondary"
          onClick={() => window.location.reload()}
        >
          {t.reload}
        </button>
      )}
    </div>
  )
}
