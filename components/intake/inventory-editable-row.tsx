'use client'
import { useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { ArrowUpRight, Check, LoaderCircle, Pencil } from 'lucide-react'
import {
  NavigationLink as Link,
  useUnsavedChanges,
} from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import { useBusyState } from '@/components/platform/work-activity'
import { inventoryRowCommand } from '@/lib/engine/inventory-row'
import type { DirectoryItem } from '@/lib/engine/item-directory'
import type { Dictionary } from '@/lib/i18n'
import {
  InventorySelectItem,
  useInventorySelection,
} from './inventory-selection'

type Field = 'title' | 'category' | 'itemType' | 'assortment'
type Snapshot = Record<Field, string> & { version: number }
type Edit = { field: Field; value: string; base: Snapshot }
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
    t = d.itemWorkflow,
    w = d.inventoryWorkspace
  const source: Snapshot = {
    title: item.title ?? '',
    category: item.category ?? '',
    itemType: item.classification?.itemType ?? '',
    assortment: item.classification?.assortment ?? '',
    version: item.classification?.version ?? 0,
  }
  const { selected } = useInventorySelection()
  const [confirmed, setConfirmed] = useState<Snapshot | null>(null)
  // A refresh from an earlier save may arrive after a later cell has committed.
  const current =
    confirmed && confirmed.version > source.version ? confirmed : source
  const [edit, setEdit] = useState<Edit | null>(null)
  const [busy, setBusy] = useBusyState(false)
  const [state, setState] = useState<
    'idle' | 'saved' | 'invalid' | 'uncertain' | 'refused'
  >('idle')
  const pending = useRef<ReturnType<typeof inventoryRowCommand.parse> | null>(
    null,
  )
  const running = useRef(false),
    cancelled = useRef(false),
    queued = useRef<Field | null>(null)
  const buttons = useRef<Partial<Record<Field, HTMLButtonElement | null>>>({})
  const dirty = !!edit && edit.value !== edit.base[edit.field]
  useUnsavedChanges(
    (dirty && state !== 'refused') || busy || state === 'uncertain'
      ? d.leaveUnsaved
      : null,
    `inventory-${item.id}`,
  )

  function open(field: Field) {
    if (state === 'uncertain' || state === 'refused' || state === 'invalid')
      return
    if (running.current) {
      queued.current = field
      return
    }
    cancelled.current = false
    setEdit({ field, value: current[field], base: current })
    setState('idle')
  }
  function cancel() {
    if (!edit || running.current || state === 'uncertain') return
    cancelled.current = true
    queued.current = null
    const field = edit.field
    setEdit(null)
    setState('idle')
    requestAnimationFrame(() => buttons.current[field]?.focus())
  }
  async function save(value = edit?.value, focus = false) {
    if (!edit || running.current || cancelled.current || state === 'refused')
      return
    if (!pending.current && value?.trim() === edit.base[edit.field]) {
      const field = queued.current
      queued.current = null
      setEdit(field ? { field, value: current[field], base: current } : null)
      setState('idle')
      if (focus && !field)
        requestAnimationFrame(() => buttons.current[edit.field]?.focus())
      return
    }
    const next = { ...edit.base, [edit.field]: value ?? '' }
    const parsed = inventoryRowCommand.safeParse(
      pending.current ?? {
        tenantId,
        requestId: crypto.randomUUID(),
        itemId: item.id,
        expected: {
          title: edit.base.title,
          category: edit.base.category,
          version: edit.base.version,
        },
        title: next.title,
        category: next.category,
        itemType: next.itemType || null,
        assortment: next.assortment || null,
      },
    )
    if (!parsed.success) {
      queued.current = null
      setState('invalid')
      return
    }
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setState('idle')
    try {
      const response = await fetch('/api/items/row', {
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
        const saved: Snapshot = {
          title: parsed.data.title,
          category: parsed.data.category,
          itemType: parsed.data.itemType ?? '',
          assortment: parsed.data.assortment ?? '',
          version: parsed.data.expected.version + 1,
        }
        setConfirmed(saved)
        pending.current = null
        setState('saved')
        const field = queued.current
        queued.current = null
        setEdit(field ? { field, value: saved[field], base: saved } : null)
        if (focus && !field)
          requestAnimationFrame(() => buttons.current[edit.field]?.focus())
        router.refresh()
      } else if (response.status >= 400 && response.status < 500) {
        pending.current = null
        queued.current = null
        setState('refused')
      } else {
        queued.current = null
        setState('uncertain')
      }
    } catch {
      queued.current = null
      setState('uncertain')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  function handleKey(
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    field: Field,
  ) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
    if (state === 'uncertain' || state === 'refused') return
    if (event.key === 'Enter') {
      event.preventDefault()
      void save(undefined, true)
    }
    if (event.key === 'Tab') {
      const fields: Field[] = ['title', 'category', 'itemType', 'assortment']
      const next = fields[fields.indexOf(field) + (event.shiftKey ? -1 : 1)]
      if (next) {
        event.preventDefault()
        queued.current = next
        void save()
      }
    }
  }
  function cell(
    field: Field,
    label: string,
    options?: { id: string; name: string }[],
  ) {
    const active = edit?.field === field
    const shown = options
      ? (options.find((option) => option.id === current[field])?.name ?? '—')
      : current[field] || '—'
    if (!write) return <span className="inventory-cell-text">{shown}</span>
    return (
      <div className="inventory-cell-editor">
        <button
          type="button"
          ref={(node) => {
            buttons.current[field] = node
          }}
          className={`inventory-cell-button${field === 'title' ? ' inventory-item-link' : ''}`}
          data-editing={active || undefined}
          aria-label={`${t.editRow} ${label}: ${shown}`}
          aria-disabled={
            state === 'uncertain' || state === 'refused' || state === 'invalid'
          }
          title={w.cellHint}
          onClick={() => open(field)}
        >
          <span>{shown}</span>
          <Pencil size={12} aria-hidden="true" />
        </button>
        {active &&
          (options ? (
            <select
              autoFocus
              aria-label={label}
              value={edit.value}
              disabled={busy || state === 'uncertain' || state === 'refused'}
              onChange={(e) => {
                const value = e.target.value
                setEdit({ ...edit, value })
                setState('idle')
              }}
              onBlur={() => {
                if (
                  !running.current &&
                  state !== 'uncertain' &&
                  state !== 'refused'
                )
                  void save()
              }}
              onKeyDown={(e) => handleKey(e, field)}
            >
              <option value="">{t.none}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              aria-label={label}
              aria-invalid={state === 'invalid' || undefined}
              value={edit.value}
              maxLength={1000}
              required={field === 'title'}
              readOnly={busy || state === 'uncertain' || state === 'refused'}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setEdit({ ...edit, value: e.target.value })
                setState('idle')
              }}
              onBlur={() => {
                if (state !== 'uncertain' && state !== 'refused') void save()
              }}
              onKeyDown={(e) => handleKey(e, field)}
            />
          ))}
      </div>
    )
  }
  const message =
    state === 'invalid'
      ? w.invalid
      : state === 'uncertain'
        ? t.uncertain
        : state === 'refused'
          ? t.changed
          : busy
            ? w.saving
            : state === 'saved'
              ? w.saved
              : ''
  return (
    <tr
      className={`inventory-row${edit ? ' inventory-row-editing' : ''}`}
      data-selected={selected.includes(item.id) || undefined}
      aria-busy={busy || undefined}
    >
      <td>
        <InventorySelectItem
          id={item.id}
          label={`${d.labelSheets.title}: ${current.title || item.id}`}
        />
      </td>
      <th scope="row">
        <div className="inventory-item-heading">
          {cell('title', d.items.item)}
          <Link
            className="inventory-open-item"
            href={`/intake/items/${item.id}`}
            aria-label={`${w.open}: ${current.title || d.items.item}`}
            title={w.open}
          >
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          {(busy || state === 'saved') && (
            <span className="inventory-save-indicator" title={message}>
              {busy ? (
                <LoaderCircle
                  size={14}
                  className="inventory-saving"
                  aria-hidden="true"
                />
              ) : (
                <Check size={14} aria-hidden="true" />
              )}
            </span>
          )}
        </div>
        {message && (
          <span
            role="status"
            className={
              state === 'invalid' ||
              state === 'uncertain' ||
              state === 'refused'
                ? 'inventory-edit-message'
                : 'sr-only'
            }
          >
            {message}
          </span>
        )}
        {state === 'uncertain' && (
          <button
            type="button"
            className="text-link inventory-retry"
            onClick={() => void save()}
          >
            {t.retry}
          </button>
        )}
        {state === 'refused' && (
          <button
            type="button"
            className="text-link inventory-retry"
            onClick={() => window.location.reload()}
          >
            {t.reload}
          </button>
        )}
      </th>
      <td>{indicators}</td>
      <td>{cell('category', d.quickIntake.category)}</td>
      <td>{cell('itemType', d.quickIntake.itemType, types)}</td>
      <td>{cell('assortment', t.group, groups)}</td>
      {children}
    </tr>
  )
}
