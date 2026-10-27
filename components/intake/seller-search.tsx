'use client'

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/components/platform/use-working-router'
import { useConfirmNavigation } from '@/components/platform/navigation-warning'
import { WorkspaceSearchTransition } from '@/components/ui/workspace-tabs'

/** Keep the input and its selection mounted while server results change. */
export function SellerSearch({ children }: { children: ReactNode }) {
  const router = useRouter()
  const confirm = useConfirmNavigation()
  const startSearch = useContext(WorkspaceSearchTransition)
  const search = useSearchParams().toString()
  const previousSearch = useRef(search)
  const form = useRef<HTMLFormElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composing = useRef(false)
  const requested = useRef(new Set<string>())
  const latest = useRef('')
  const searchFocused = useRef(false)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useLayoutEffect(() => {
    // Retain and apply text entered before React attached its input listener.
    if (previousSearch.current === search) {
      const input = form.current?.elements.namedItem('q')
      if (
        input instanceof HTMLInputElement &&
        input.value.trim() !== (new URLSearchParams(search).get('q') ?? '')
      )
        timer.current = setTimeout(() => form.current?.requestSubmit(), 275)
      return
    }
    previousSearch.current = search
    // Older replies must not overwrite text entered while they were loading.
    if (requested.current.delete(search)) {
      // Next's initial route cache can append the fragment to an already
      // anchored canonical URL when clearing back to the original query.
      if (/^(#seller-search){2,}$/.test(window.location.hash)) {
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search + '#seller-search',
        )
        window.dispatchEvent(new HashChangeEvent('hashchange'))
        const input = form.current?.elements.namedItem('q')
        if (searchFocused.current && input instanceof HTMLInputElement)
          requestAnimationFrame(() => {
            if (input.isConnected && document.activeElement === document.body)
              input.focus({ preventScroll: true })
          })
      }
      if (search === latest.current) requested.current.clear()
      return
    }
    cancel()
    requested.current.clear()
    const input = form.current?.elements.namedItem('q')
    if (input instanceof HTMLInputElement)
      input.value = new URLSearchParams(search).get('q') ?? ''
  }, [search])
  useEffect(() => {
    const leaving = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('a[href], [role="tab"]')
      )
        cancel()
    }
    const history = () => {
      cancel()
      requested.current.clear()
    }
    const hashChanged = () => {
      if (window.location.hash !== '#seller-search') cancel()
    }
    window.addEventListener('popstate', history)
    window.addEventListener('hashchange', hashChanged)
    document.addEventListener('click', leaving, true)
    return () => {
      cancel()
      window.removeEventListener('popstate', history)
      window.removeEventListener('hashchange', hashChanged)
      document.removeEventListener('click', leaving, true)
    }
  }, [])
  const apply = () => {
    cancel()
    if (!form.current || composing.current || !form.current.checkValidity())
      return
    const query = String(new FormData(form.current).get('q') ?? '').trim()
    const next = new URLSearchParams(window.location.search)
    next.delete('sellerPage')
    if (query) next.set('q', query)
    else next.delete('q')
    const value = next.toString()
    if (
      (value === window.location.search.slice(1) &&
        requested.current.size === 0) ||
      !confirm()
    )
      return
    requested.current.add(value)
    latest.current = value
    searchFocused.current =
      document.activeElement === form.current.elements.namedItem('q')
    const navigate = () =>
      router.replace(`/intake${value ? '?' + value : ''}#seller-search`, {
        scroll: false,
      })
    if (startSearch) startSearch(navigate)
    else navigate()
  }
  const schedule = () => {
    cancel()
    if (!composing.current) timer.current = setTimeout(apply, 275)
  }
  return (
    <form
      ref={form}
      action="/intake#seller-search"
      method="get"
      role="search"
      className="field"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
      onChange={schedule}
      onCompositionStart={() => {
        composing.current = true
        cancel()
      }}
      onCompositionEnd={() => {
        composing.current = false
        schedule()
      }}
    >
      {children}
    </form>
  )
}
