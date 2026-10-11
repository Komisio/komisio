'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

const subscribeReady = () => () => {}
const clientReady = () => true
const serverReady = () => false

function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
    window.removeEventListener('popstate', notify)
  }
}

/** Task tabs retain mounted forms and support bookmarks and browser history. */
export function WorkspaceTabs({
  id,
  label,
  initial,
  toolbar,
  toolbarTabs,
  tabs,
}: {
  id: string
  label: string
  initial?: string
  toolbar?: ReactNode
  toolbarTabs?: string[]
  tabs: { id: string; label: string; content: ReactNode; anchors?: string[] }[]
}) {
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady)
  const fallback = tabs.some((tab) => tab.id === initial)
    ? initial!
    : tabs[0].id
  const selected = useSyncExternalStore(
    subscribe,
    () =>
      tabs.find(
        (tab) =>
          window.location.hash === `#${id}-${tab.id}` ||
          tab.anchors?.some((anchor) => window.location.hash === '#' + anchor),
      )?.id ?? fallback,
    () => fallback,
  )
  function select(tab: string) {
    window.history.pushState(null, '', `#${id}-${tab}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return (
    <div
      className="workspace-tabs"
      onClickCapture={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return
        const link =
          event.target instanceof Element
            ? event.target.closest('a[href]')
            : null
        if (
          !(link instanceof HTMLAnchorElement) ||
          link.hasAttribute('download') ||
          (link.target && link.target !== '_self')
        )
          return
        const destination = new URL(link.href)
        if (
          destination.origin !== window.location.origin ||
          destination.pathname !== window.location.pathname ||
          destination.search !== window.location.search
        )
          return
        const tab = tabs.find((tab) => destination.hash === `#${id}-${tab.id}`)
        if (!tab) return
        // Next Link can update a fragment without a native hashchange event.
        // Handle same-workspace anchors here so their mounted panels follow it.
        event.preventDefault()
        select(tab.id)
        document.getElementById(`${id}-tab-${tab.id}`)?.focus()
      }}
    >
      <div className="workspace-tablist" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${id}-tab-${tab.id}`}
            type="button"
            disabled={!ready}
            role="tab"
            aria-selected={selected === tab.id}
            aria-controls={`${id}-${tab.id}`}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : null
              if (next !== null) {
                event.preventDefault()
                select(tabs[next].id)
                document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus()
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {toolbar && (
        <div
          className="workspace-toolbar"
          hidden={toolbarTabs && !toolbarTabs.includes(selected)}
        >
          {toolbar}
        </div>
      )}
      {tabs.map((tab) => (
        <section
          key={tab.id}
          id={`${id}-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab.id}`}
          tabIndex={0}
          hidden={selected !== tab.id}
          className="workspace-tabpanel"
        >
          {tab.content}
        </section>
      ))}
    </div>
  )
}
