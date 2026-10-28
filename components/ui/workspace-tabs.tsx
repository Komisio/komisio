'use client'

import { Check, TriangleAlert } from 'lucide-react'

import {
  createContext,
  useEffect,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from 'react'

export const WorkspaceSearchTransition =
  createContext<TransitionStartFunction | null>(null)

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
  scrollAnchors = false,
  tabs,
}: {
  id: string
  label: string
  initial?: string
  toolbar?: ReactNode
  toolbarTabs?: string[]
  scrollAnchors?: boolean
  tabs: {
    id: string
    label: string
    notice?: string
    status?: { approved: boolean; label: string }
    content: ReactNode
    anchors?: string[]
  }[]
}) {
  const [searching, startSearch] = useTransition()
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady)
  const fallback = tabs.some((tab) => tab.id === initial)
    ? initial!
    : tabs[0].id
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )
  const selected =
    tabs.find(
      (tab) =>
        hash === `#${id}-${tab.id}` ||
        tab.anchors?.some((anchor) => hash === '#' + anchor),
    )?.id ?? fallback
  const anchor = scrollAnchors
    ? tabs
        .find((tab) => tab.id === selected)
        ?.anchors?.find((anchor) => hash === '#' + anchor)
    : undefined
  useEffect(() => {
    // A browser can resolve the fragment while its tab is still hidden or
    // streaming. Restore explicit deep-link scrolling after the panel commits.
    if (anchor)
      document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
  }, [anchor])
  function select(tab: string) {
    if (searching) return
    window.history.pushState(null, '', `#${id}-${tab}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return (
    <WorkspaceSearchTransition.Provider value={startSearch}>
      <div
        className="workspace-tabs"
        onSubmitCapture={(event) => {
          const form = event.target
          if (
            !(form instanceof HTMLFormElement) ||
            !form.hasAttribute('data-workspace-filter') ||
            form.method !== 'get'
          )
            return
          const destination = new URL(form.action)
          if (
            destination.origin !== window.location.origin ||
            destination.pathname !== window.location.pathname
          )
            return
          destination.hash = `${id}-${selected}`
          form.action = destination.href
        }}
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
          const tab = tabs.find(
            (tab) => destination.hash === `#${id}-${tab.id}`,
          )
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
              disabled={!ready || searching}
              role="tab"
              data-status={
                tab.status
                  ? tab.status.approved
                    ? 'approved'
                    : 'missing'
                  : undefined
              }
              aria-label={
                tab.status
                  ? `${tab.label} — ${tab.status.label}`
                  : tab.notice
                    ? `${tab.label} — ${tab.notice}`
                    : undefined
              }
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
              {tab.status &&
                (tab.status.approved ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <TriangleAlert size={18} aria-hidden="true" />
                ))}
              {tab.label}
              {tab.notice && (
                <span aria-hidden="true" title={tab.notice}>
                  {' '}
                  ●
                </span>
              )}
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
    </WorkspaceSearchTransition.Provider>
  )
}
