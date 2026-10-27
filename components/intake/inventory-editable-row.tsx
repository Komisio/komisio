'use client'
import { ItemPriceCell } from './item-price-cell'
import { useEffect, type ReactNode } from 'react'
import { ArrowUpRight, Check, LoaderCircle } from 'lucide-react'
import { InventoryItemLink } from './inventory-item-link'
import type { DirectoryItem } from '@/lib/engine/item-directory'
import type { Dictionary, Locale } from '@/lib/i18n'
import { useItemQuickEdit } from './use-item-quick-edit'
import {
  InventorySelectItem,
  useInventorySelection,
} from './inventory-selection'

export function InventoryEditableRow({
  item,
  tenantId,
  currency,
  locale,
  write,
  types,
  groups,
  categories,
  d,
  indicators,
  children,
}: {
  item: DirectoryItem
  tenantId: string
  currency: string
  locale: Locale
  write: boolean
  types: { id: string; name: string }[]
  groups: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  d: Dictionary
  indicators: ReactNode
  children: ReactNode
}) {
  const t = d.itemWorkflow,
    w = d.inventoryWorkspace
  const { selected, updateItem } = useInventorySelection()
  const { cell, current, edit, busy, state, message, retry } = useItemQuickEdit(
    { item, tenantId, write, d, warningScope: 'inventory-table' },
  )
  // Selection actions must use the confirmed edit even before the server
  // refresh returns, including its optimistic concurrency version.
  useEffect(() => {
    updateItem({
      id: item.id,
      title: current.title,
      category: current.category,
      classification: {
        id: item.id,
        version: current.version,
        itemType: current.itemType || null,
        assortment: current.assortment || null,
      },
    })
  }, [
    item.id,
    current.title,
    current.category,
    current.version,
    current.itemType,
    current.assortment,
    updateItem,
  ])
  return (
    <tr
      id={`inventory-item-${item.id}`}
      className={`inventory-row inventory-row-open${edit ? ' inventory-row-editing' : ''}`}
      data-selected={selected.includes(item.id) || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          edit ||
          busy ||
          !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target) ||
          event.target.closest(
            'a, button, input, select, textarea, label, summary, dialog, [role="button"], [role="link"], [contenteditable="true"], [data-row-control]',
          ) ||
          window.getSelection()?.toString()
        )
          return
        // Reuse the real link's navigation guard, loading feedback and destination.
        event.currentTarget
          .querySelector<HTMLAnchorElement>('.inventory-open-item')
          ?.click()
      }}
    >
      <td data-row-control>
        <InventorySelectItem
          id={item.id}
          label={`${d.labelSheets.title}: ${current.title || item.id}`}
        />
      </td>
      <th scope="row">
        <div className="inventory-item-heading">
          {cell('title', d.items.item)}
          <InventoryItemLink
            className="inventory-open-item"
            itemId={item.id}
            aria-label={`${w.open}: ${current.title || d.items.item}`}
            title={w.open}
          >
            <ArrowUpRight size={15} aria-hidden="true" />
          </InventoryItemLink>
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
            onClick={retry}
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
      <td>{cell('category', d.quickIntake.category, categories)}</td>
      <td>{cell('itemType', d.quickIntake.itemType, types)}</td>
      <td className="inventory-number inventory-price" data-row-control>
        <ItemPriceCell
          tenantId={tenantId}
          itemId={item.id}
          priceOre={
            item.currentPriceOre === null ? null : String(item.currentPriceOre)
          }
          currency={currency}
          locale={locale}
          title={current.title}
          write={
            write &&
            ['on_sale', 'markdown_due', 'period_ending'].includes(item.stage)
          }
          d={d}
        />
      </td>
      <td className="inventory-indicator-cell">{indicators}</td>
      <td>{cell('assortment', t.group, groups)}</td>
      {children}
    </tr>
  )
}
