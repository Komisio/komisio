import type { ReactNode } from 'react'
import type { ItemStage } from '@/lib/engine/items'

/** Shared presentation only; callers retain their localized status labels. */
export function ItemStatusBadge({
  stage,
  children,
  className = '',
}: {
  stage: ItemStage
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`item-status-badge ${className}`} data-stage={stage}>
      {children}
    </span>
  )
}
