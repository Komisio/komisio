'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** Nested task navigation keeps unsaved forms mounted when staff switch tasks. */
export function SellerEconomyTabs({
  label,
  initial,
  tabs,
}: {
  label: string
  initial: string
  tabs: { id: string; label: string; content: ReactNode }[]
}) {
  const [selected, setSelected] = useState(initial)
  useEffect(() => {
    function sync() {
      const value = window.location.hash.replace('#seller-economy-', '')
      if (tabs.some((tab) => tab.id === value)) setSelected(value)
      else if (window.location.hash === '#seller-ledger') setSelected('history')
      else if (window.location.hash === '#seller-economy') setSelected(initial)
    }
    sync()
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [initial, tabs])
  const active = tabs.some((tab) => tab.id === selected) ? selected : initial
  function select(id: string) {
    setSelected(id)
    window.history.pushState(null, '', `#seller-economy-${id}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return (
    <div className="seller-economy-tasks">
      <div className="seller-economy-tablist" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`economy-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`seller-economy-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
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
              if (next === null) return
              event.preventDefault()
              select(tabs[next].id)
              document.getElementById(`economy-tab-${tabs[next].id}`)?.focus()
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <section
          key={tab.id}
          id={`seller-economy-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`economy-tab-${tab.id}`}
          tabIndex={0}
          hidden={active !== tab.id}
          className="seller-economy-panel"
        >
          {tab.content}
        </section>
      ))}
    </div>
  )
}
