'use client'
import { useEffect } from 'react'
import { useRouter } from '@/components/platform/use-working-router'

/** Old settings bookmarks keep reaching the now separate account-map tab. */
export function AccountingLegacyMapLink() {
  const router = useRouter()
  useEffect(() => {
    const redirect = () => {
      if (window.location.hash === '#account-map')
        router.replace('/intake/accounting?view=accounts#account-map')
    }
    redirect()
    window.addEventListener('hashchange', redirect)
    window.addEventListener('popstate', redirect)
    return () => {
      window.removeEventListener('hashchange', redirect)
      window.removeEventListener('popstate', redirect)
    }
  }, [router])
  return null
}
