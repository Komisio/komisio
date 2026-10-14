'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import { classificationCommand } from '@/lib/engine/item-classification'
import { labelOf, type ItemTypeProfile } from '@/lib/engine/attributes'
import type { Dictionary, Locale } from '@/lib/i18n'
export function ItemClassificationEditor({
  tenantId,
  items,
  groups,
  types,
  locale,
  manage,
  d,
}: {
  tenantId: string
  items: { id: string; version: number; title: string }[]
  groups: { id: string; name: string }[]
  types: ItemTypeProfile[]
  locale: Locale
  manage: boolean
  d: Dictionary
}) {
  const t = d.itemWorkflow,
    router = useRouter(),
    [busy, setBusy] = useBusyState(false),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false),
    [status, setStatus] = useState('')
  const [pendingAction, setPendingAction] = useState<
    'group' | 'classify' | null
  >(null)
  const [kind, setKind] = useState(''),
    [group, setGroup] = useState(''),
    [name, setName] = useState('')
  const pending = useRef<ReturnType<typeof classificationCommand.parse> | null>(
      null,
    ),
    running = useRef(false)
  async function send(action: 'group' | 'classify') {
    if (running.current || refused) return
    const parsed = classificationCommand.safeParse(
      pending.current ??
        (action === 'group'
          ? { action, tenantId, requestId: crypto.randomUUID(), name }
          : {
              action,
              tenantId,
              requestId: crypto.randomUUID(),
              items: items.map(({ id, version }) => ({ id, version })),
              itemType: kind === 'none' ? null : kind,
              assortment: group === 'none' ? null : group,
            }),
    )
    if (!parsed.success) return
    pending.current = parsed.data
    setPendingAction(parsed.data.action)
    running.current = true
    setBusy(true)
    setLocked(true)
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
        setStatus(t.saved)
        setName('')
        router.refresh()
      } else if (response.status >= 400 && response.status < 500) {
        setRefused(true)
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
          void send('classify')
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
          className="btn"
          disabled={
            busy ||
            refused ||
            !items.length ||
            Boolean(locked && pendingAction !== 'classify')
          }
        >
          {t.save}
        </button>
      </form>
      {manage && (
        <details>
          <summary>{t.newGroup}</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send('group')
            }}
            className="row wrap"
            style={{ alignItems: 'end' }}
          >
            <label>
              {t.name}
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={locked || busy}
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={
                busy || refused || Boolean(locked && pendingAction !== 'group')
              }
            >
              {t.createGroup}
            </button>
          </form>
        </details>
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
