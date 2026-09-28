'use client'
import Link from 'next/link'
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
