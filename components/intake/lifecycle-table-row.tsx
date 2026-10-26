'use client'
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function LifecycleTableRow({
  id,
  title,
  photo,
  cells,
  children,
  initiallyOpen,
  selection,
}: {
  id: string
  title: string
  photo: ReactNode
  cells: ReactNode
  children: ReactNode
  initiallyOpen: boolean
  selection?: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <>
      <tr id={`lifecycle-${id}`} className="lifecycle-row" data-open={open}>
        {selection && <td>{selection}</td>}
        <th scope="row">
          <div className="lifecycle-table-title">
            <button
              type="button"
              className="lifecycle-expand"
              aria-expanded={open}
              aria-controls={`lifecycle-detail-${id}`}
              onClick={() => setOpen(!open)}
            >
              {open ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
              <span>{title}</span>
            </button>
            {photo}
          </div>
        </th>
        {cells}
      </tr>
      <tr
        id={`lifecycle-detail-${id}`}
        className="lifecycle-detail-row"
        hidden={!open}
      >
        <td colSpan={selection ? 9 : 8}>
          <div className="lifecycle-detail">{children}</div>
        </td>
      </tr>
    </>
  )
}
