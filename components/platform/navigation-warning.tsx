'use client'
import Link from 'next/link'
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
  register: (message: string) => () => void
  confirm: () => boolean
}
const NavigationWarnings = createContext<Warnings | null>(null)

/** Forms own their warning lifetime; the shell never stores their contents. */
export function NavigationWarningProvider({
  children,
}: {
  children: ReactNode
}) {
  const messages = useRef(new Map<symbol, string>())
  const warnings = useMemo<Warnings>(
    () => ({
      register(message) {
        const key = Symbol()
        messages.current.set(key, message)
        return () => {
          messages.current.delete(key)
        }
      },
      confirm() {
        const active = [...new Set(messages.current.values())]
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

export function useNavigationWarning(message: string | null) {
  const warnings = useContext(NavigationWarnings)
  useEffect(() => {
    if (message && warnings) return warnings.register(message)
  }, [message, warnings])
}

/** Warn on supported in-app links and document unload without storing form data. */
export function useUnsavedChanges(message: string | null) {
  useNavigationWarning(message)
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

export function useConfirmNavigation() {
  const warnings = useContext(NavigationWarnings)
  return () => warnings?.confirm() ?? true
}

/** onNavigate leaves downloads, external links and new-tab clicks alone. */
export function NavigationLink({
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const confirm = useConfirmNavigation()
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
