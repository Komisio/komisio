'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { browserClient } from '@/lib/supabase/client'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Feedback } from './feedback'

export function SignOut({ d }: { d: Dictionary }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  return (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const { error } = await browserClient().auth.signOut()
            if (error) throw error
            router.push('/login')
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
