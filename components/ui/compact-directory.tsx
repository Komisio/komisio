import type { ReactNode } from 'react'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { DirectoryRow } from './directory-row'

export type DirectoryColumn = {
  key: string
  label: string
  mobileLabel?: string | null
  numeric?: boolean
  width?: number
  href?: string
  order?: 'ascending' | 'descending'
}

/** Shared, semantic table with compact phone rows and real sortable header links. */
export function CompactDirectory({
  columns,
  rows,
  label,
}: {
  columns: DirectoryColumn[]
  rows: { id: string; cells: ReactNode[] }[]
  label: string
}) {
  return (
    <div className="compact-directory">
      <table
        className="compact-directory-table"
        role="table"
        aria-label={label}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: `${column.width}%` } : undefined}
                aria-sort={column.order}
                className={column.numeric ? 'directory-number' : undefined}
              >
                {column.href ? (
                  <Link href={column.href} className="directory-sort-link">
                    {column.label}
                    {column.order === 'ascending' ? (
                      <ArrowUp size={14} aria-hidden="true" />
                    ) : column.order === 'descending' ? (
                      <ArrowDown size={14} aria-hidden="true" />
                    ) : null}
                  </Link>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DirectoryRow key={row.id}>
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index].key}
                  className={
                    columns[index].numeric ? 'directory-number' : undefined
                  }
                >
                  {index > 0 && columns[index].mobileLabel !== null && (
                    <span className="directory-cell-label" aria-hidden="true">
                      {columns[index].mobileLabel ?? columns[index].label}
                    </span>
                  )}
                  <div className="directory-cell-value">{cell}</div>
                </td>
              ))}
            </DirectoryRow>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Native GET control keeps sorting available when headers collapse on phones. */
export function DirectoryOrder({
  columns,
  value,
  label,
  ascending,
  descending,
  id,
}: {
  columns: { key: string; label: string }[]
  value: string
  label: string
  ascending: string
  descending: string
  id: string
}) {
  return (
    <div className="field directory-order">
      <label htmlFor={id}>{label}</label>
      <select id={id} name="order" defaultValue={value}>
        {columns.flatMap((column) =>
          ['asc', 'desc'].map((direction) => (
            <option
              key={`${column.key}:${direction}`}
              value={`${column.key}:${direction}`}
            >
              {column.label} · {direction === 'asc' ? ascending : descending}
            </option>
          )),
        )}
      </select>
    </div>
  )
}
