'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@/lib/supabase/client'
import { safeNext } from '@/lib/platform/validation'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Feedback } from '@/components/platform/feedback'
export function MfaForm({
  d,
  verified = false,
  factorId,
  next = '/',
  enroll = false,
}: {
  d: Dictionary
  verified?: boolean
  factorId?: string
  next?: string
  enroll?: boolean
}) {
  const [factor, setFactor] = useState(factorId ?? '')
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(verified)
  const router = useRouter()
  async function start() {
    setBusy(true)
    setError('')
    try {
      const client = browserClient()
      const { data: factors } = await client.auth.mfa.listFactors()
      for (const pending of factors?.all.filter(
        (f) => f.status === 'unverified' && f.factor_type === 'totp',
      ) ?? [])
        await client.auth.mfa.unenroll({ factorId: pending.id })
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Komisio',
      })
      if (error) throw error
      setFactor(data.id)
      setQr(data.totp.qr_code)
    } catch {
      setError(d.authError)
    } finally {
      setBusy(false)
    }
  }
  if (done)
    return (
      <>
        <p className="notice notice-success">{d.mfaEnabled}</p>
        <small>{d.mfaRecovery}</small>
      </>
    )
  return (
    <>
      <p>{enroll ? d.mfaIntro : d.mfaLoginIntro}</p>
      {enroll && !factor ? (
        <Button variant="secondary" disabled={busy} onClick={start}>
          {d.mfaEnable}
        </Button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              const fields = new FormData(e.currentTarget)
              const { error } =
                await browserClient().auth.mfa.challengeAndVerify({
                  factorId: factor,
                  code: String(fields.get('code')),
                })
              if (error) throw error
              if (enroll) {
                setDone(true)
                router.refresh()
              } else {
                router.push(safeNext(next))
                router.refresh()
              }
            } catch {
              setError(d.authError)
            } finally {
              setBusy(false)
            }
          }}
        >
          {qr && (
            <>
              <p>{d.mfaScan}</p>
              {/* Keep the Auth SVG data URI in the browser: it contains the enrollment secret. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="qr"
                src={qr}
                alt={d.mfaScan}
                width={200}
                height={200}
              />
            </>
          )}
          <div className="field">
            <label htmlFor="mfa-code">{d.mfaCode}</label>
            <input
              id="mfa-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              minLength={6}
              maxLength={6}
            />
          </div>
          <Button disabled={busy}>{d.mfaVerify}</Button>
        </form>
      )}
      <Feedback error={error} />
    </>
  )
}
