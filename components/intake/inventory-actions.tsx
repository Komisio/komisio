'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, Pencil, Printer, Tag, X } from 'lucide-react'
import { WorkingForm } from '@/components/platform/working-form'
import {
  NavigationLink as Link,
  useUnsavedChanges,
  useConfirmNavigation,
} from '@/components/platform/navigation-warning'
import type { DirectoryItem } from '@/lib/engine/item-directory'
import type { ItemTypeProfile } from '@/lib/engine/attributes'
import type { Dictionary, Locale } from '@/lib/i18n'
import { useInventorySelection } from './inventory-selection'
import { ItemClassificationEditor } from './item-classification-editor'

type SelectedItem = { id: string; version: number; title: string }
export function InventoryActions({
  items,
  tenantId,
  groups,
  types,
  locale,
  write,
  manage,
  d,
}: {
  items: DirectoryItem[]
  tenantId: string
  groups: { id: string; name: string }[]
  types: ItemTypeProfile[]
  locale: Locale
  write: boolean
  manage: boolean
  d: Dictionary
}) {
  const { ids, selected, setSelected, updates } = useInventorySelection()
  const chosen = items
    .map((item) => {
      const update = updates[item.id]
      return update &&
        (update.classification?.version ?? 0) >
          (item.classification?.version ?? 0)
        ? { ...item, ...update }
        : item
    })
    .filter((item) => ids.includes(item.id) && selected.includes(item.id))
  const [batch, setBatch] = useState<SelectedItem[] | null>(null)
  const confirm = useConfirmNavigation('inventory-table')
  const editButton = useRef<HTMLButtonElement>(null)
  const single = chosen.length === 1 ? chosen[0] : null
  function close() {
    setBatch(null)
    editButton.current?.focus()
  }
  if (!chosen.length && !batch) return null
  return (
    <tr className="inventory-selection-row">
      <th colSpan={13}>
        <div
          className="inventory-selection-toolbar"
          aria-label={d.inventoryWorkspace.actions}
        >
          <span className="inventory-selection-count" role="status">
            {chosen.length === 1
              ? d.inventoryWorkspace.selectedOne
              : d.inventoryWorkspace.selected.replace(
                  '{count}',
                  String(chosen.length),
                )}
          </span>
          <WorkingForm
            id="label-selection"
            action="/intake/items/labels"
            className="inventory-selection-tools"
          >
            {write && (
              <button
                ref={editButton}
                type="button"
                onClick={() => {
                  if (!confirm()) return
                  setBatch(
                    chosen.map((item) => ({
                      id: item.id,
                      title: item.title || d.items.item,
                      version: item.classification?.version ?? 0,
                    })),
                  )
                }}
              >
                <Pencil size={15} aria-hidden="true" />
                {d.inventoryWorkspace.editSelected}
              </button>
            )}
            <button type="submit">
              <Printer size={15} aria-hidden="true" />
              {d.labelSheets.title}
            </button>
            {single && (
              <>
                <Link href={`/intake/items/${single.id}`}>
                  <ArrowUpRight size={15} aria-hidden="true" />
                  {d.inventoryWorkspace.open}
                </Link>
                {write && (
                  <Link
                    href={`/intake/lifecycle?q=I-${single.id.slice(0, 8).toUpperCase()}#lifecycle-${single.id}`}
                  >
                    <Tag size={15} aria-hidden="true" />
                    {d.items.manageSalePeriod}
                  </Link>
                )}
              </>
            )}
          </WorkingForm>
          <button
            type="button"
            className="inventory-clear-selection"
            onClick={() => setSelected([])}
            title={d.inventoryWorkspace.clear}
            aria-label={d.inventoryWorkspace.clear}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {batch && (
          <BatchDialog
            items={batch}
            tenantId={tenantId}
            groups={groups}
            types={types}
            locale={locale}
            manage={manage}
            d={d}
            close={close}
          />
        )}
      </th>
    </tr>
  )
}
function BatchDialog({
  items,
  tenantId,
  groups,
  types,
  locale,
  manage,
  d,
  close,
}: {
  items: SelectedItem[]
  tenantId: string
  groups: { id: string; name: string }[]
  types: ItemTypeProfile[]
  locale: Locale
  manage: boolean
  d: Dictionary
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId()
  const [locked, setLocked] = useState(false)
  useUnsavedChanges(locked ? d.leaveUnsaved : null, 'inventory-table')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="inventory-batch-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault()
        if (!locked) close()
      }}
    >
      <div className="inventory-batch-heading">
        <h2 id={id}>{d.itemWorkflow.bulk}</h2>
        <button
          type="button"
          aria-label={d.printing.close}
          disabled={locked}
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <details className="inventory-batch-items" open>
        <summary>
          {items.length === 1
            ? d.inventoryWorkspace.selectedOne
            : d.inventoryWorkspace.selected.replace(
                '{count}',
                String(items.length),
              )}
        </summary>
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {item.title}{' '}
              <small>· I-{item.id.slice(0, 8).toUpperCase()}</small>
            </li>
          ))}
        </ul>
      </details>
      <ItemClassificationEditor
        tenantId={tenantId}
        items={items}
        groups={groups}
        types={types}
        locale={locale}
        manage={manage}
        d={d}
        onLockedChange={setLocked}
        onSaved={close}
      />
    </dialog>
  )
}
