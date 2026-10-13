'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { browserClient } from '@/lib/supabase/client'
import { useRouter } from '@/components/platform/use-working-router'
import { useBusyState } from '@/components/platform/work-activity'
import { Button } from '@/components/ui/button'
import { Feedback } from '@/components/platform/feedback'
import { dictionary, type Locale } from '@/lib/i18n'

export function SellerActivation({
  tokenHash,
  locale,
}: {
  tokenHash: string
  locale: Locale
}) {
  const d = dictionary(locale)
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  return (
    <section className="card">
      <h1>{d.sellerActivation.title}</h1>
      <p>{d.sellerActivation.intro}</p>
      <Button
        disabled={busy || !tokenHash}
        onClick={async () => {
          if (running.current) return
          running.current = true
          setBusy(true)
          setError('')
          try {
            const client = browserClient()
            const { error: failure } = await client.auth.verifyOtp({
              token_hash: tokenHash,
              type: 'email',
            })
            if (failure) throw failure
            document.cookie = `komisio-locale=${locale};path=/;SameSite=Lax`
            const { data, error: assuranceError } =
              await client.auth.mfa.getAuthenticatorAssuranceLevel()
            if (assuranceError) throw assuranceError
            router.replace(
              data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
                ? '/mfa?next=/seller/activate'
                : '/seller/activate',
            )
            router.refresh()
          } catch {
            setError(d.callbackError)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        {busy ? d.loading : d.sellerActivation.confirm}
      </Button>
      <Feedback error={error || (!tokenHash ? d.callbackError : '')} />
      <p>
        <Link href="/login?next=/seller" className="text-link">
          {d.login}
        </Link>
      </p>
    </section>
  )
}
