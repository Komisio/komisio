import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { Dictionary } from '@/lib/i18n'

export function InventoryTableShell({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div
      className="inventory-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="inventory-table">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  )
}

export function InventorySortHeader({
  selected,
  direction,
  href,
  label,
  d,
  numeric = false,
  preserveDraft = false,
}: {
  selected: boolean
  direction: 'asc' | 'desc'
  href: string
  label: string
  d: Dictionary['items']['directory']
  numeric?: boolean
  preserveDraft?: boolean
}) {
  const next = selected && direction === 'asc' ? 'desc' : 'asc'
  return (
    <th
      scope="col"
      className={numeric ? 'inventory-number' : undefined}
      aria-sort={
        selected ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <Link
        warningScope={preserveDraft ? 'inventory-table' : undefined}
        href={href}
        aria-label={`${label}: ${next === 'asc' ? d.sortAsc : d.sortDesc}`}
      >
        {label}
        {selected ? (
          direction === 'asc' ? (
            <ArrowUp size={13} aria-hidden="true" />
          ) : (
            <ArrowDown size={13} aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown size={13} aria-hidden="true" />
        )}
      </Link>
    </th>
  )
}

export function InventoryFooter({
  total,
  offset,
  count,
  page,
  pages,
  href,
  d,
  label = d.pagination,
  preserveDraft = false,
  showDisabled = true,
}: {
  total: number
  offset: number
  count: number
  page: number
  pages: number
  href: (page: number) => string
  d: Dictionary['items']
  label?: string
  preserveDraft?: boolean
  showDisabled?: boolean
}) {
  const pageLink = (target: number, text: string, enabled: boolean) =>
    enabled ? (
      <Link
        warningScope={preserveDraft ? 'inventory-table' : undefined}
        className="btn btn-secondary"
        href={href(target)}
      >
        {text}
      </Link>
    ) : showDisabled ? (
      <span className="btn btn-secondary" aria-disabled="true">
        {text}
      </span>
    ) : null
  return (
    <footer className="inventory-footer">
      <span>
        {d.showingRange
          .replace('{from}', String(total ? offset + 1 : 0))
          .replace('{to}', String(offset + count))
          .replace('{total}', String(total))}
      </span>
      {pages > 1 && (
        <nav className="inventory-pagination" aria-label={label}>
          {pageLink(page - 1, d.previousPage, page > 1)}
          <span>
            {d.pageOf
              .replace('{page}', String(page))
              .replace('{pages}', String(pages))}
          </span>
          {pageLink(page + 1, d.nextPage, page < pages)}
        </nav>
      )}
    </footer>
  )
}
