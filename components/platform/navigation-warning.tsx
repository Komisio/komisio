'use client'
import Link from '@/components/platform/working-link'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react'

type Warnings = {
  register: (message: string, scope?: string) => () => void
  confirm: (scope?: string) => boolean
}
const NavigationWarnings = createContext<Warnings | null>(null)

/** Forms own their warning lifetime; the shell never stores their contents. */
export function NavigationWarningProvider({
  children,
}: {
  children: ReactNode
}) {
  const messages = useRef(
    new Map<symbol, { message: string; scope?: string }>(),
  )
  const warnings = useMemo<Warnings>(
    () => ({
      register(message, scope) {
        const key = Symbol()
        messages.current.set(key, { message, scope })
        return () => {
          messages.current.delete(key)
        }
      },
      confirm(scope) {
        const active = [
          ...new Set(
            [...messages.current.values()]
              .filter((entry) => scope === undefined || entry.scope === scope)
              .map((entry) => entry.message),
          ),
        ]
        return active.length === 0 || window.confirm(active.join('\n\n'))
      },
    }),
    [],
  )
  return (
    <NavigationWarnings.Provider value={warnings}>
      {children}
    </NavigationWarnings.Provider>
  )
}

export function useNavigationWarning(message: string | null, scope?: string) {
  const warnings = useContext(NavigationWarnings)
  useEffect(() => {
    if (message && warnings) return warnings.register(message, scope)
  }, [message, scope, warnings])
}

/** Warn on supported in-app links and document unload without storing form data. */
export function useUnsavedChanges(message: string | null, scope?: string) {
  useNavigationWarning(message, scope)
  useEffect(() => {
    if (!message) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [message])
}

export function useConfirmNavigation(scope?: string) {
  const warnings = useContext(NavigationWarnings)
  return () => warnings?.confirm(scope) ?? true
}

/**
 * onNavigate leaves downloads, external links and new-tab clicks alone.
 * A scope is only for navigation that retains every other mounted draft.
 */
export function NavigationLink({
  onNavigate,
  warningScope,
  ...props
}: ComponentProps<typeof Link> & { warningScope?: string }) {
  const confirm = useConfirmNavigation(warningScope)
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        // In-page anchors do not discard the form.
        const destination =
          typeof props.href === 'string'
            ? new URL(props.href, window.location.href)
            : null
        const samePage =
          destination?.pathname === window.location.pathname &&
          destination?.search === window.location.search
        if (!samePage && !confirm()) {
          event.preventDefault()
          return
        }
        onNavigate?.(event)
      }}
    />
  )
}
