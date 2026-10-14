'use client'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
const Selection = createContext<{
  ids: string[]
  selected: string[]
  setSelected: (ids: string[]) => void
}>({ ids: [], selected: [], setSelected: () => {} })
export function InventorySelection({
  ids,
  children,
}: {
  ids: string[]
  children: ReactNode
}) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <Selection.Provider value={{ ids, selected, setSelected }}>
      {children}
    </Selection.Provider>
  )
}
export function InventorySelectAll({ label }: { label: string }) {
  const { ids, selected, setSelected } = useContext(Selection),
    ref = useRef<HTMLInputElement>(null)
  const count = ids.filter((id) => selected.includes(id)).length
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < ids.length
  }, [count, ids.length])
  return (
    <input
      ref={ref}
      className="inventory-checkbox"
      type="checkbox"
      aria-label={label}
      checked={ids.length > 0 && count === ids.length}
      disabled={!ids.length}
      onChange={(e) => setSelected(e.target.checked ? ids : [])}
    />
  )
}
export function useInventorySelection() {
  return useContext(Selection)
}
export function InventorySelectItem({
  id,
  label,
}: {
  id: string
  label: string
}) {
  const { ids, selected, setSelected } = useContext(Selection)
  return (
    <input
      className="inventory-checkbox"
      type="checkbox"
      name="item"
      form="label-selection"
      value={id}
      aria-label={label}
      disabled={!ids.includes(id)}
      checked={selected.includes(id)}
      onChange={(e) =>
        setSelected(
          e.target.checked
            ? [...selected, id]
            : selected.filter((value) => value !== id),
        )
      }
    />
  )
}
