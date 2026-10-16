'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import type { ComponentProps } from 'react'
import { NavigationLink } from '@/components/platform/navigation-warning'
import { itemFromListHref } from '@/lib/intake/item-return'

/** A real URL retains listing context on reload, new tabs and guarded navigation. */
export function InventoryItemLink({
  itemId,
  hash = '',
  ...props
}: Omit<ComponentProps<typeof NavigationLink>, 'href'> & {
  itemId: string
  hash?: string
}) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  return (
    <NavigationLink
      {...props}
      href={itemFromListHref(
        itemId,
        pathname + (search ? '?' + search : ''),
        hash,
      )}
    />
  )
}
