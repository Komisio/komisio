'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { browserClient } from '@/lib/supabase/client'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Feedback } from './feedback'
import { useConfirmNavigation } from './navigation-warning'
import { safeNext } from '@/lib/platform/validation'

export function SignOut({ d, next }: { d: Dictionary; next?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const confirmNavigation = useConfirmNavigation()
  return (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (busy || !confirmNavigation()) return
          setBusy(true)
          setError('')
          try {
            const { error } = await browserClient().auth.signOut()
            if (error) throw error
            const destination = safeNext(next)
            router.push(
              destination === '/'
                ? '/login'
                : `/login?next=${encodeURIComponent(destination)}`,
            )
            router.refresh()
          } catch {
            setError(d.authError)
          } finally {
            setBusy(false)
          }
        }}
      >
        <LogOut size={14} />
        {d.logout}
      </Button>
      <Feedback error={error} />
    </>
  )
}
