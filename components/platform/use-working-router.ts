'use client'
import { useMemo } from 'react'
import { useRouter as useNextRouter } from 'next/navigation'
import { useBusyTransition } from './work-activity'

/** Track refresh/navigation through React, without observing prefetch traffic. */
export function useRouter() {
  const router = useNextRouter()
  const [, startTransition] = useBusyTransition()
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        startTransition(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        startTransition(() => router.replace(...args)),
      refresh: () => startTransition(() => router.refresh()),
      back: () => startTransition(() => router.back()),
      forward: () => startTransition(() => router.forward()),
    }),
    [router, startTransition],
  )
}
