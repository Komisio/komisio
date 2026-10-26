'use client'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { DirectoryItem } from '@/lib/engine/item-directory'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false
type ItemUpdate = Pick<
  DirectoryItem,
  'id' | 'title' | 'category' | 'classification'
>
const Selection = createContext<{
  ids: string[]
  selected: string[]
  setSelected: (ids: string[]) => void
  updates: Record<string, ItemUpdate>
  updateItem: (item: ItemUpdate) => void
}>({
  ids: [],
  selected: [],
  setSelected: () => {},
  updates: {},
  updateItem: () => {},
})
export function InventorySelection({
  ids,
  children,
}: {
  ids: string[]
  children: ReactNode
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [updates, setUpdates] = useState<Record<string, ItemUpdate>>({})
  const updateItem = useCallback((item: ItemUpdate) => {
    setUpdates((previous) =>
      (previous[item.id]?.classification?.version ?? -1) >=
      (item.classification?.version ?? 0)
        ? previous
        : { ...previous, [item.id]: item },
    )
  }, [])
  return (
    <Selection.Provider
      value={{ ids, selected, setSelected, updates, updateItem }}
    >
      {children}
    </Selection.Provider>
  )
}
export function InventorySelectAll({ label }: { label: string }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
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
      disabled={!ready || !ids.length}
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
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const { ids, selected, setSelected } = useContext(Selection)
  return (
    <input
      className="inventory-checkbox"
      type="checkbox"
      name="item"
      value={id}
      aria-label={label}
      disabled={!ready || !ids.includes(id)}
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
