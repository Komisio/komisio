'use client'
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Dictionary } from '@/lib/i18n'
import './seller-tabs.css'
export const sellerTabs = [
  'overview',
  'dropoffs',
  'items',
  'economy',
  'terms',
  'communication',
  'details',
] as const
export type SellerTab = (typeof sellerTabs)[number]
function currentTab(): SellerTab {
  const value = window.location.hash.replace('#seller-', '')
  return sellerTabs.includes(value as SellerTab)
    ? (value as SellerTab)
    : 'overview'
}
function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
    window.removeEventListener('popstate', notify)
  }
}
export function SellerTabs({
  d,
  panels,
}: {
  d: Dictionary['sellerWorkspace']
  panels: Record<SellerTab, ReactNode>
}) {
  const selected = useSyncExternalStore(
    subscribe,
    currentTab,
    () => 'overview' as SellerTab,
  )
  const strip = useRef<HTMLDivElement>(null)
  // On a phone the strip scrolls sideways; a deep link, a shortcut or a
  // click may select a tab beyond its visible width. Scroll the strip alone,
  // never the page, so the selected tab is in view.
  useEffect(() => {
    const list = strip.current
    const tab = document.getElementById('seller-tab-' + selected)
    if (!list || !tab) return
    // The strip is positioned, so the tab's offsetLeft is relative to it.
    const pad = 12
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left - pad < list.scrollLeft)
      list.scrollTo({ left: Math.max(0, left - pad) })
    else if (right + pad > list.scrollLeft + list.clientWidth)
      list.scrollTo({ left: right + pad - list.clientWidth })
  }, [selected])
  function select(tab: SellerTab) {
    window.history.pushState(null, '', '#seller-' + tab)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return (
    <div className="seller-workspace">
      <div
        className="seller-tablist"
        role="tablist"
        aria-label={d.intro}
        ref={strip}
      >
        {sellerTabs.map((tab, index) => (
          <button
            key={tab}
            id={'seller-tab-' + tab}
            type="button"
            role="tab"
            aria-selected={selected === tab}
            aria-controls={'seller-' + tab}
            tabIndex={selected === tab ? 0 : -1}
            onClick={() => select(tab)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % sellerTabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + sellerTabs.length - 1) % sellerTabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? sellerTabs.length - 1
                        : null
              if (next !== null) {
                event.preventDefault()
                select(sellerTabs[next])
                document
                  .getElementById('seller-tab-' + sellerTabs[next])
                  ?.focus()
              }
            }}
          >
            {d[tab]}
          </button>
        ))}
      </div>
      {sellerTabs.map((tab) => (
        <section
          key={tab}
          id={'seller-' + tab}
          role="tabpanel"
          aria-labelledby={'seller-tab-' + tab}
          tabIndex={0}
          hidden={selected !== tab}
          className="seller-tabpanel"
        >
          {panels[tab]}
        </section>
      ))}
    </div>
  )
}
