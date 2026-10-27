import type { ComponentProps, ReactNode } from 'react'
import { InventoryActions } from './inventory-actions'
import { InventoryEditableRow } from './inventory-editable-row'
import { InventoryItemLink } from './inventory-item-link'
import { InventorySelection, InventorySelectAll } from './inventory-selection'
import './inventory-edit.css'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { Handshake, Store, TrendingDown } from 'lucide-react'
import {
  InventoryTableShell,
  InventorySortHeader,
} from './inventory-table-shell'
import { dictionary, intlLocale, type Locale } from '@/lib/i18n'
import type { DirectoryItem, ItemSort } from '@/lib/engine/item-directory'
import { ItemPhotoPreview } from './item-photo-preview'
import { ItemIndicator } from './item-indicator'
import { labelOf, type ItemTypeProfile } from '@/lib/engine/attributes'
import {
  categoryChoices,
  type ItemCategory,
} from '@/lib/engine/item-categories'

export function InventoryTable({
  items,
  tenantId,
  currency,
  locale,
  groups,
  types,
  categories,
  write,
  manage,
  sort,
  direction,
  sortHref,
  selectionKey,
  preserveDraft = false,
  children,
}: {
  items: DirectoryItem[]
  tenantId: string
  currency: string
  locale: Locale
  groups: ComponentProps<typeof InventoryActions>['groups']
  types: ItemTypeProfile[]
  categories: ItemCategory[]
  write: boolean
  manage: boolean
  sort: ItemSort
  direction: 'asc' | 'desc'
  sortHref: (sort: ItemSort, direction: 'asc' | 'desc') => string
  selectionKey: string
  preserveDraft?: boolean
  children?: ReactNode
}) {
  const all = dictionary(locale),
    d = all.items,
    t = d.directory
  // Intake paging/sorting keeps its keyed reception editor mounted.
  const stageLabel = (s: keyof typeof all.lifecycle.stages) =>
    s === 'markdown_due' ? d.markdownWaiting : all.lifecycle.stages[s]
  const date = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Europe/Stockholm',
    }).format(new Date(value))
  const header = (key: ItemSort, label: string, numeric = false) => {
    const selected = sort === key
    const next = selected && direction === 'asc' ? 'desc' : 'asc'
    return (
      <InventorySortHeader
        selected={selected}
        direction={direction}
        href={sortHref(key, next)}
        label={label}
        d={t}
        numeric={numeric}
        preserveDraft={preserveDraft}
      />
    )
  }

  return (
    <InventorySelection key={selectionKey} ids={items.map((i) => i.id)}>
      <InventoryTableShell label={d.list}>
        <thead>
          <InventoryActions
            items={items}
            tenantId={tenantId}
            currency={currency}
            groups={groups}
            types={types}
            locale={locale}
            write={write}
            manage={manage}
            d={all}
          />
          <tr>
            <th scope="col">
              <InventorySelectAll label={all.itemWorkflow.selectAll} />
            </th>
            {header('title', d.item)}
            {header('category', all.quickIntake.category)}
            <th scope="col">{all.quickIntake.itemType}</th>
            {header('price', all.quickIntake.price, true)}
            <th scope="col" className="inventory-indicator-cell">
              <span className="sr-only">{t.details}</span>
            </th>
            <th scope="col">{all.itemWorkflow.group}</th>
            {header('seller', all.quickIntake.seller)}
            {header('stage', d.stage)}
            <th scope="col">{all.itemSync.title}</th>
            {header('accepted', t.registered)}
            {header('periodEnd', t.periodEnd)}
            <th scope="col">
              <span className="sr-only">{d.ownership}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <InventoryEditableRow
              key={i.id}
              item={i}
              tenantId={tenantId}
              currency={currency}
              locale={locale}
              write={write}
              types={types
                .filter(
                  (type) =>
                    type.active || type.slug === i.classification?.itemType,
                )
                .map((type) => ({
                  id: type.slug,
                  name: labelOf(type, locale),
                }))}
              groups={groups}
              categories={categoryChoices(categories, locale)}
              d={all}
              indicators={
                <div className="inventory-indicators">
                  {i.defaultPhotoId && (
                    <ItemPhotoPreview
                      tenantId={tenantId}
                      itemId={i.id}
                      photoId={i.defaultPhotoId}
                      count={i.photoCount}
                      title={i.title || d.item}
                      d={all.itemPhotos}
                    />
                  )}
                </div>
              }
            >
              <td>
                {i.sellerId ? (
                  <Link
                    className="inventory-seller"
                    href={`/intake/sellers/${i.sellerId}`}
                    title={i.sellerName || undefined}
                  >
                    {i.sellerName || '—'}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className="inventory-state" data-stage={i.stage}>
                {i.stage === 'markdown_due' ? (
                  <ItemIndicator
                    warning
                    label={
                      i.nextMarkdownAt
                        ? t.markdownOn
                            .replace('{date}', date(i.nextMarkdownAt))
                            .replace(
                              '{percent}',
                              String(i.nextMarkdownPercent ?? ''),
                            )
                        : d.markdownWaiting
                    }
                  >
                    <TrendingDown size={17} aria-hidden="true" />
                  </ItemIndicator>
                ) : (
                  stageLabel(i.stage)
                )}
              </td>
              <td>
                {i.sync?.length
                  ? i.sync.map((connection) => (
                      <InventoryItemLink
                        key={connection.connectionId}
                        className="item-sync-state inventory-sync-link"
                        data-state={connection.status}
                        itemId={i.id}
                        hash="#sync-status"
                      >
                        {all.itemSync.providers[connection.provider]} ·{' '}
                        {all.itemSync.states[connection.status]}
                      </InventoryItemLink>
                    ))
                  : '—'}
              </td>
              <td className="inventory-date">
                <time dateTime={i.acceptedAt}>{date(i.acceptedAt)}</time>
              </td>
              <td className="inventory-date">
                <time dateTime={i.periodEnd}>{date(i.periodEnd)}</time>
              </td>
              <td>
                <ItemIndicator label={d.ownershipKinds[i.ownership]}>
                  {i.ownership === 'store' ? (
                    <Store size={16} aria-hidden="true" />
                  ) : (
                    <Handshake size={16} aria-hidden="true" />
                  )}
                </ItemIndicator>
              </td>
            </InventoryEditableRow>
          ))}
        </tbody>
      </InventoryTableShell>

      {children}
    </InventorySelection>
  )
}
