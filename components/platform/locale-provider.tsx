'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Locale } from '../../lib/i18n'

const LocaleContext = createContext<Locale>('sv')

/** Root document language, also available when a route fails to render. */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale
  children?: ReactNode
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  )
}

export function useDocumentLocale() {
  return useContext(LocaleContext)
}
