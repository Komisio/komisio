'use client'
import { useEffect, useRef, type ReactNode } from 'react'

/** Preserve existing registration deep links while keeping search first. */
export function NewSellerDisclosure({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const reveal = () => {
      if (location.hash === '#new-seller' && disclosure.current) {
        disclosure.current.open = true
        disclosure.current
          .querySelector<HTMLInputElement>('#seller-name')
          ?.focus()
      }
    }
    reveal()
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [])
  return (
    <details ref={disclosure} className="intake-registration">
      <summary>{title}</summary>
      {children}
    </details>
  )
}
