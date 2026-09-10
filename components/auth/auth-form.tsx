'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { browserClient } from '@/lib/supabase/client'
import { dictionary, type Locale } from '@/lib/i18n'
import { safeNext } from '@/lib/platform/validation'
import { Button } from '@/components/ui/button'
import { Feedback } from '@/components/platform/feedback'
import { Brand } from '@/components/platform/brand'
export function AuthForm({
  mode,
  next = '/',
  callbackError = false,
  initialLocale = 'sv',
}: {
  mode: 'login' | 'register' | 'reset' | 'password'
  next?: string
  callbackError?: boolean
  initialLocale?: Locale
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const d = dictionary(locale)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [email, setEmail] = useState('')
  const router = useRouter()
  const destination = safeNext(next)
  function changeLocale(value: Locale) {
    setLocale(value)
    document.cookie = `komisio-locale=${value};path=/;SameSite=Lax`
    document.documentElement.lang = value
  }
  async function submit(form: React.FormEvent<HTMLFormElement>) {
    form.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    const fields = new FormData(form.currentTarget)
    const password = String(fields.get('password') ?? '')
    const client = browserClient()
    const base = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
    try {
      if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
        router.push(
          data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
            ? `/mfa?next=${encodeURIComponent(destination)}`
            : destination,
        )
        router.refresh()
      } else if (mode === 'register') {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(destination)}`,
          },
        })
        if (error) throw error
        if (data.session) {
          router.push(destination)
          router.refresh()
        } else setSuccess(d.verifySent)
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${base}/auth/callback?next=/account`,
        })
        if (error) throw error
        setSuccess(d.resetSent)
      } else {
        const { error } = await client.auth.updateUser({ password })
        if (error) throw error
        setSuccess(d.saved)
      }
    } catch {
      setError(d.authError)
    } finally {
      setBusy(false)
    }
  }
  async function resend() {
    setBusy(true)
    setError('')
    try {
      const { error } = await browserClient().auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(destination)}`,
        },
      })
      if (error) throw error
      setSuccess(d.verifySent)
    } catch {
      setError(d.authError)
    } finally {
      setBusy(false)
    }
  }
  const title =
    mode === 'login'
      ? d.login
      : mode === 'register'
        ? d.register
        : mode === 'reset'
          ? d.reset
          : d.passwordChange
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand light />
        <div>
          <div className="auth-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="eyebrow">Komisio</div>
          <h1>{d.tagline}</h1>
          <p>{d.help}</p>
        </div>
        <small>Komisio · Open source</small>
      </aside>
      <main className="auth-main">
        <div className="locale-switch">
          <button onClick={() => changeLocale('sv')} lang="sv">
            Svenska
          </button>
          <span>·</span>
          <button onClick={() => changeLocale('en')} lang="en">
            English
          </button>
        </div>
        <div className="auth-form">
          <div style={{ marginBottom: 35 }}>
            <Brand />
          </div>
          <h1>{title}</h1>
          <p>
            {mode === 'register'
              ? d.registerIntro
              : mode === 'login'
                ? d.loginIntro
                : d.passwordHint}
          </p>
          <form onSubmit={submit}>
            {mode !== 'password' && (
              <div className="field">
                <label htmlFor="email">{d.email}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={254}
                />
              </div>
            )}
            {mode !== 'reset' && (
              <div className="field">
                <label htmlFor="password">
                  {mode === 'password' ? d.newPassword : d.password}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  minLength={mode === 'login' ? 1 : 10}
                  required
                />
                {mode !== 'login' && <small>{d.passwordHint}</small>}
              </div>
            )}
            {mode === 'login' && (
              <p
                style={{ textAlign: 'right', marginTop: -8, marginBottom: 24 }}
              >
                <Link href="/reset-password" className="text-link">
                  {d.forgot}
                </Link>
              </p>
            )}
            <Button disabled={busy} className="full">
              {busy
                ? d.loading
                : mode === 'reset'
                  ? d.sendReset
                  : mode === 'password'
                    ? d.savePassword
                    : title}
              <ArrowRight size={16} />
            </Button>
            <Feedback
              error={error || (callbackError ? d.callbackError : '')}
              success={success}
            />
          </form>
          {success && mode === 'register' && (
            <Button variant="ghost" onClick={resend} disabled={busy}>
              {d.resend}
            </Button>
          )}
          <p className="auth-footer">
            {mode === 'login' ? (
              <>
                {d.noAccount}{' '}
                <Link
                  className="text-link"
                  href={`/register?next=${encodeURIComponent(destination)}`}
                >
                  {d.register}
                </Link>
              </>
            ) : mode === 'register' ? (
              <>
                {d.hasAccount}{' '}
                <Link
                  className="text-link"
                  href={`/login?next=${encodeURIComponent(destination)}`}
                >
                  {d.login}
                </Link>
              </>
            ) : (
              <Link
                href={mode === 'password' ? '/' : '/login'}
                className="text-link"
              >
                {mode === 'password' ? d.back : d.backLogin}
              </Link>
            )}
          </p>
        </div>
      </main>
    </div>
  )
}
