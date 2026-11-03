'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Columns3 } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'

const optionalColumns = [
  'category',
  'itemType',
  'assortment',
  'sync',
  'accepted',
  'periodEnd',
] as const
type Column = (typeof optionalColumns)[number]
const ColumnCount = createContext(13)
export const useInventoryColumnCount = () => useContext(ColumnCount)

export function InventoryColumns({
  tenantId,
  d,
  children,
}: {
  tenantId: string
  d: Dictionary
  children: ReactNode
}) {
  const [visible, setVisible] = useState<Column[]>([])
  const [ready, setReady] = useState(false)
  const key = `komisio-inventory-columns:${tenantId}`
  const t = d.items.directory
  const labels: Record<Column, string> = {
    category: d.quickIntake.category,
    itemType: d.quickIntake.itemType,
    assortment: d.itemWorkflow.group,
    sync: d.itemSync.title,
    accepted: t.registered,
    periodEnd: t.periodEnd,
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
        setVisible(
          Array.isArray(value)
            ? optionalColumns.filter((column) => value.includes(column))
            : [],
        )
      } catch {
        // Storage may be blocked or contain an older/malformed preference.
        setVisible([])
      }
      setReady(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [key])
  function change(columns: Column[]) {
    setVisible(columns)
    try {
      localStorage.setItem(key, JSON.stringify(columns))
    } catch {
      // The current view remains usable without persistent browser storage.
    }
  }
  return (
    <ColumnCount.Provider value={7 + visible.length}>
      <div className="inventory-columns" data-columns={visible.join(' ')}>
        <details className="inventory-column-picker">
          <summary>
            <Columns3 size={16} aria-hidden="true" />
            {t.columns.title}
          </summary>
          <fieldset disabled={!ready}>
            <legend className="sr-only">{t.columns.title}</legend>
            <p>{t.columns.core}</p>
            <div className="inventory-column-options">
              {optionalColumns.map((column) => (
                <label key={column}>
                  <input
                    type="checkbox"
                    checked={visible.includes(column)}
                    aria-label={t.columns.show.replace(
                      '{column}',
                      labels[column],
                    )}
                    onChange={(event) =>
                      change(
                        event.target.checked
                          ? [...visible, column]
                          : visible.filter((value) => value !== column),
                      )
                    }
                  />
                  {labels[column]}
                </label>
              ))}
            </div>
            <button
              type="button"
              className="text-link"
              disabled={!visible.length}
              onClick={() => change([])}
            >
              {t.columns.reset}
            </button>
          </fieldset>
        </details>
        {children}
      </div>
    </ColumnCount.Provider>
  )
}
