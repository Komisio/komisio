'use client'
import { useRef, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useBusyState } from '@/components/platform/work-activity'
import { inventoryRowCommand } from '@/lib/engine/inventory-row'
import type { DirectoryItem } from '@/lib/engine/item-directory'
import type { Dictionary } from '@/lib/i18n'
import { InventorySelectItem } from './inventory-selection'
export function InventoryEditableRow({
  item,
  tenantId,
  write,
  types,
  groups,
  d,
  indicators,
  children,
}: {
  item: DirectoryItem
  tenantId: string
  write: boolean
  types: { id: string; name: string }[]
  groups: { id: string; name: string }[]
  d: Dictionary
  indicators: ReactNode
  children: ReactNode
}) {
  const router = useRouter(),
    t = d.itemWorkflow
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(''),
    [category, setCategory] = useState(''),
    [kind, setKind] = useState(''),
    [group, setGroup] = useState('')
  const [busy, setBusy] = useBusyState(false),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false),
    [message, setMessage] = useState('')
  const [expected, setExpected] = useState({
    title: '',
    category: '',
    version: 0,
    itemType: '',
    assortment: '',
  })
  const pending = useRef<ReturnType<typeof inventoryRowCommand.parse> | null>(
      null,
    ),
    running = useRef(false)
  const dirty =
    editing &&
    (title !== expected.title ||
      category !== expected.category ||
      kind !== expected.itemType ||
      group !== expected.assortment)
  useUnsavedChanges(
    dirty || locked ? d.leaveUnsaved : null,
    `inventory-${item.id}`,
  )
  const formId = `inventory-edit-${item.id}`
  function open() {
    const snapshot = {
      title: item.title ?? '',
      category: item.category ?? '',
      version: item.classification?.version ?? 0,
      itemType: item.classification?.itemType ?? '',
      assortment: item.classification?.assortment ?? '',
    }
    setExpected(snapshot)
    setTitle(snapshot.title)
    setCategory(snapshot.category)
    setKind(snapshot.itemType)
    setGroup(snapshot.assortment)
    setMessage('')
    setRefused(false)
    setEditing(true)
  }
  async function save() {
    if (running.current || refused) return
    const parsed = inventoryRowCommand.safeParse(
      pending.current ?? {
        tenantId,
        requestId: crypto.randomUUID(),
        itemId: item.id,
        expected: {
          title: expected.title,
          category: expected.category,
          version: expected.version,
        },
        title,
        category,
        itemType: kind || null,
        assortment: group || null,
      },
    )
    if (!parsed.success) {
      setMessage(d.intake.invalid)
      return
    }
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setLocked(true)
    setMessage('')
    try {
      const r = await fetch('/api/items/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = await r.json()
      if (r.ok && body.ok === true && body.id === parsed.data.requestId) {
        pending.current = null
        setLocked(false)
        setEditing(false)
        setMessage(t.saved)
        router.refresh()
      } else if (r.status >= 400 && r.status < 500) {
        setRefused(true)
        setLocked(false)
        setMessage(t.changed)
      } else setMessage(t.uncertain)
    } catch {
      setMessage(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const fieldProps = {
    form: formId,
    disabled: busy || locked || refused,
    maxLength: 1000,
  }
  return (
    <tr className={`inventory-row${editing ? ' inventory-row-editing' : ''}`}>
      <td>
        <InventorySelectItem
          id={item.id}
          label={`${d.labelSheets.title}: ${item.title || item.id}`}
        />
      </td>
      <th scope="row">
        {editing ? (
          <input
            {...fieldProps}
            autoFocus
            aria-label={t.description}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        ) : (
          <Link
            className="inventory-item-link"
            href={`/intake/items/${item.id}`}
            title={item.title || undefined}
          >
            {item.title?.trim() || d.items.item}
          </Link>
        )}
      </th>
      <td>{indicators}</td>
      <td>
        {editing ? (
          <input
            {...fieldProps}
            aria-label={d.quickIntake.category}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        ) : (
          <span
            className="inventory-cell-text"
            title={item.category || undefined}
          >
            {item.category || '—'}
          </span>
        )}
      </td>
      <td>
        {editing ? (
          <select
            form={formId}
            disabled={busy || locked || refused}
            aria-label={d.quickIntake.itemType}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{t.none}</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        ) : (
          (types.find((type) => type.id === item.classification?.itemType)
            ?.name ?? '—')
        )}
      </td>
      <td>
        {editing ? (
          <select
            form={formId}
            disabled={busy || locked || refused}
            aria-label={t.group}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">{t.none}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        ) : (
          (groups.find((g) => g.id === item.classification?.assortment)?.name ??
          '—')
        )}
      </td>
      <td className="inventory-row-actions">
        {write &&
          (editing ? (
            <form
              id={formId}
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <div className="inventory-edit-actions">
                <button
                  className="btn btn-primary"
                  disabled={
                    busy || refused || (!dirty && !locked) || !title.trim()
                  }
                >
                  {locked ? t.retry : t.save}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || locked}
                  onClick={() => {
                    setEditing(false)
                    setMessage('')
                    pending.current = null
                  }}
                >
                  {t.cancel}
                </button>
              </div>
              {refused && (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  {t.reload}
                </button>
              )}
            </form>
          ) : (
            <button
              type="button"
              className="inventory-edit-trigger"
              aria-label={`${t.editRow}: ${item.title || d.items.item}`}
              title={t.editRow}
              onClick={open}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          ))}
        {message && (
          <span
            role="status"
            className={editing ? 'inventory-edit-message' : 'sr-only'}
          >
            {message}
          </span>
        )}
      </td>
      {children}
    </tr>
  )
}
