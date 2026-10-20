'use client'
import { createContext, useContext, type ReactNode } from 'react'
import type { HelpCatalog } from '@/lib/help/content'
type HelpContext = { tenantId: string; locale: string; articles: HelpCatalog }
const Context = createContext<HelpContext | null>(null)
export function HelpContentProvider({
  value,
  children,
}: {
  value: HelpContext
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useHelpContent = () => useContext(Context)
