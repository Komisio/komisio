'use client'

import {
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ReceivingPanel } from './receiving-panel'

function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
    window.removeEventListener('popstate', notify)
  }
}

function navigate(hash: string) {
  window.history.pushState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** Keep legacy bookmarks, but mount a fresh registration on each opening. */
export function SellerSearchStep({
  children,
  registration,
  cancelLabel,
}: {
  children: ReactNode
  registration: ComponentProps<typeof ReceivingPanel> | null
  cancelLabel: string
}) {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )
  const [locked, setLocked] = useState(false)
  // A lost reply must remain retryable with the original request, even after Back.
  const registering = registration && (hash === '#new-seller' || locked)
  return (
    <div
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
          link.target ||
          link.hasAttribute('download')
        )
          return
        const destination = new URL(link.href)
        if (
          registration &&
          destination.origin === location.origin &&
          destination.pathname === location.pathname &&
          destination.search === location.search &&
          destination.hash === '#new-seller'
        ) {
          event.preventDefault()
          navigate('#new-seller')
        }
      }}
    >
      {registering ? (
        <div id="new-seller" className="intake-registration-step">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={locked}
            onClick={() => {
              navigate('#seller-search')
              requestAnimationFrame(() =>
                document.getElementById('seller-search')?.focus(),
              )
            }}
          >
            {cancelLabel}
          </button>
          <ReceivingPanel {...registration} onLockChange={setLocked} />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
