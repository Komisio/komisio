'use client'
import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  clearReturnPositions,
  takeReturnPosition,
} from '@/lib/platform/return-scroll'

function RestorePosition() {
  const path = usePathname()
  const query = useSearchParams().toString()
  useEffect(() => {
    const href = path + (query ? '?' + query : '') + window.location.hash
    const y = takeReturnPosition(href)
    if (y === null) return
    let frame = 0
    let stopped = false
    let settled = 0
    const started = performance.now()
    const stop = () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
    const restore = () => {
      if (stopped) return
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      )
      window.scrollTo({ top: Math.min(y, max), behavior: 'instant' })
      // Wait for streamed content and selected workspace panels, but never
      // fight a user's scroll or keep an observer alive indefinitely.
      settled = max >= y ? settled + 1 : 0
      if (settled < 5 && performance.now() - started < 3000)
        frame = requestAnimationFrame(restore)
    }
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      window.addEventListener(event, stop, { passive: true, once: true })
    frame = requestAnimationFrame(restore)
    return () => {
      stop()
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        window.removeEventListener(event, stop)
    }
  }, [path, query])
  return null
}
export function ReturnScroll({ tenantId }: { tenantId: string }) {
  useEffect(() => {
    clearReturnPositions()
    return clearReturnPositions
  }, [tenantId])
  return (
    <Suspense fallback={null}>
      <RestorePosition />
    </Suspense>
  )
}
