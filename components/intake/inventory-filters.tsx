'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/components/platform/use-working-router'
import { useConfirmNavigation } from '@/components/platform/navigation-warning'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

/** Keep the form mounted while server results change, including during typing. */
export function InventoryFilters({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const router = useRouter()
  const confirm = useConfirmNavigation()
  const params = useSearchParams()
  const search = params.toString()
  const form = useRef<HTMLFormElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composing = useRef(false)
  const requested = useRef(new Set<string>())
  const latest = useRef('')
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useLayoutEffect(() => {
    // A response to our search must not replace text typed while it was loading.
    if (requested.current.delete(search)) {
      if (search === latest.current) requested.current.clear()
      return
    }
    cancel()
    requested.current.clear()
    const query = new URLSearchParams(search)
    // Preserve bookmarks created before provider-neutral sync filters existed.
    if (query.get('paypal')) {
      if (!query.has('syncProvider')) query.set('syncProvider', 'paypal')
      if (!query.has('syncStatus'))
        query.set('syncStatus', query.get('paypal')!)
    }
    for (const field of Array.from(form.current?.elements ?? [])) {
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement
      )
        field.value =
          query.get(field.name) ??
          (field instanceof HTMLInputElement && field.type === 'hidden'
            ? field.defaultValue
            : '')
    }
  }, [search])
  useEffect(() => {
    const resetHistory = () => {
      cancel()
      requested.current.clear()
    }
    const leaving = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]'))
        cancel()
    }
    window.addEventListener('popstate', resetHistory)
    document.addEventListener('click', leaving, true)
    return () => {
      cancel()
      window.removeEventListener('popstate', resetHistory)
      document.removeEventListener('click', leaving, true)
    }
  }, [])
  const apply = () => {
    cancel()
    if (!form.current || composing.current || !form.current.checkValidity())
      return
    const next = new URLSearchParams()
    for (const [key, value] of new FormData(form.current)) {
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim())
    }
    if (next.has('categoryId')) next.delete('category')
    // There is deliberately no page field: changing filters starts at page one.
    const query = next.toString()
    if (
      (query === window.location.search.slice(1) &&
        requested.current.size === 0) ||
      !confirm()
    )
      return
    requested.current.add(query)
    latest.current = query
    router.replace(`/intake/items?${query}`, { scroll: false })
  }
  const schedule = (immediate = false) => {
    cancel()
    if (composing.current) return
    if (immediate) apply()
    else timer.current = setTimeout(apply, 350)
  }
  return (
    <form
      ref={form}
      action="/intake/items"
      method="get"
      role="search"
      className="inventory-filters"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
      onChange={(event) => schedule(event.target instanceof HTMLSelectElement)}
      onCompositionStart={() => {
        composing.current = true
        cancel()
      }}
      onCompositionEnd={() => {
        composing.current = false
        schedule()
      }}
    >
      <fieldset className="inventory-filter-fields" disabled={!ready}>
        {children}
      </fieldset>
    </form>
  )
}

/** Preserve the user's disclosure choice across result updates. */
export function InventoryAdvanced({
  initialOpen,
  summary,
  children,
}: {
  initialOpen: boolean
  summary: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <details
      className="inventory-advanced"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  )
}
