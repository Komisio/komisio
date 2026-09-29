'use client'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { ReactNode } from 'react'

export function NewSellerLink({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  return (
    <Link
      href="/intake#new-seller"
      className={className}
      onNavigate={() => document.getElementById('seller-name')?.focus()}
    >
      {children}
    </Link>
  )
}
