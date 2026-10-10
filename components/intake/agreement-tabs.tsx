'use client'
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import './seller-tabs.css'

const tabs = ['versions', 'sellers', 'publish'] as const
type Tab = (typeof tabs)[number]
const AgreementNavigation = createContext<((href: string) => void) | null>(null)
export function AgreementWorkspaceLink({
  href,
  ...props
}: {
  href: string
  children: ReactNode
  className?: string
  'aria-current'?: 'page'
}) {
  const navigate = useContext(AgreementNavigation)
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        if (navigate) {
          event.preventDefault()
          navigate(href)
        }
      }}
    />
  )
}
function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
    window.removeEventListener('popstate', notify)
  }
}
export function AgreementTabs({
  labels,
  initial,
  panels,
}: {
  labels: Dictionary['agreements']['workspace']
  initial: Tab
  panels: Partial<Record<Tab, ReactNode>>
}) {
  const available = tabs.filter((tab) => panels[tab] !== undefined)
  const [fallback] = useState(initial)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const selected = useSyncExternalStore(
    subscribe,
    () => {
      if (window.location.hash === '#agreement-document') return 'versions'
      const hash = window.location.hash.replace('#agreements-', '') as Tab
      return available.includes(hash)
        ? hash
        : available.includes(fallback)
          ? fallback
          : 'versions'
    },
    () => fallback,
  )
  function select(tab: Tab) {
    window.history.pushState(null, '', '#agreements-' + tab)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return (
    <AgreementNavigation.Provider
      value={(href) => {
        if (!pending) startTransition(() => router.push(href))
      }}
    >
      <div className="agreements-workspace" aria-busy={pending}>
        <div
          className="seller-tablist agreement-tablist"
          role="tablist"
          aria-label={labels.navigation}
        >
          {available.map((tab, index) => (
            <button
              key={tab}
              id={'agreement-tab-' + tab}
              type="button"
              disabled={pending}
              role="tab"
              aria-selected={selected === tab}
              aria-controls={'agreements-' + tab}
              tabIndex={selected === tab ? 0 : -1}
              onClick={() => select(tab)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % available.length
                    : event.key === 'ArrowLeft'
                      ? (index + available.length - 1) % available.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? available.length - 1
                          : null
                if (next !== null) {
                  event.preventDefault()
                  select(available[next])
                  document
                    .getElementById('agreement-tab-' + available[next])
                    ?.focus()
                }
              }}
            >
              {labels[tab]}
            </button>
          ))}
        </div>
        {available.map((tab) => (
          <section
            key={tab}
            id={'agreements-' + tab}
            role="tabpanel"
            aria-labelledby={'agreement-tab-' + tab}
            tabIndex={0}
            hidden={selected !== tab}
            className="agreement-tabpanel"
            data-panel={tab}
          >
            {panels[tab]}
          </section>
        ))}
      </div>
    </AgreementNavigation.Provider>
  )
}
