'use client'

import type { ReactNode } from 'react'

/** Enlarge the primary link's pointer target without replacing native table/link semantics. */
export function DirectoryRow({ children }: { children: ReactNode }) {
  return (
    <tr
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (event.target as Element).closest('a,button,input,select,textarea') ||
          window.getSelection()?.toString()
        )
          return
        event.currentTarget
          .querySelector<HTMLAnchorElement>('.directory-primary-link')
          ?.click()
      }}
    >
      {children}
    </tr>
  )
}
