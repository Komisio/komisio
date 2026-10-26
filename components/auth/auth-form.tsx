'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { PasswordInput } from './password-input'
import { useState, useSyncExternalStore } from 'react'
import Link from '@/components/platform/working-link'
import { useRouter } from '@/components/platform/use-working-router'
import { ArrowRight } from 'lucide-react'
import { browserClient } from '@/lib/supabase/client'
import {
  dictionary,
  intlLocale,
  type Locale,
  locales,
  localeNames,
} from '@/lib/i18n'
import { safeNext } from '@/lib/platform/validation'
import { Button } from '@/components/ui/button'
import { Feedback } from '@/components/platform/feedback'
import { Brand } from '@/components/platform/brand'
import { AdsConsentControl } from '@/components/platform/ads-consent'
import { LegalLinks } from '@/components/platform/legal-links'
import { MarketingConsentField } from '@/components/platform/marketing-consent-field'
import { signupMarketingMetadata } from '@/lib/platform/marketing-consent'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false
export function AuthForm({
  mode: initialMode,
  next = '/',
  callbackError = false,
  initialLocale = 'sv',
  marketingConsent = false,
  legalBaseUrl,
  registrationStoreName,
  initialEmail = '',
}: {
  mode: 'login' | 'register' | 'reset' | 'password' | 'confirm'
  next?: string
  callbackError?: boolean
  initialLocale?: Locale
  marketingConsent?: boolean
  legalBaseUrl?: string
  registrationStoreName?: string | null
  initialEmail?: string
}) {
  const [mode, setMode] = useState(initialMode)
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const d = dictionary(locale)
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [email, setEmail] = useState(initialEmail)
  const router = useRouter()
  const requested = safeNext(next)
  const destination =
    (mode === 'password' || mode === 'reset') &&
    requested.startsWith('/update-password')
      ? '/'
      : requested
  function changeLocale(value: Locale) {
    setLocale(value)
    document.cookie = `komisio-locale=${value};path=/;SameSite=Lax`
    document.documentElement.lang = intlLocale(value)
    const translated = dictionary(value)
    const title =
      mode === 'login'
        ? translated.login
        : mode === 'register'
          ? translated.register
          : mode === 'reset'
            ? translated.reset
            : mode === 'confirm'
              ? translated.sellerAccess.confirmEmail
              : translated.sellerAccess.choosePassword
    document.title = `${title} · Komisio`
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
        if (error?.code === 'email_not_confirmed') {
          setMode('confirm')
          return
        }
        if (error) throw error
        const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
        router.push(
          data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
            ? `/mfa?next=${encodeURIComponent(destination)}`
            : `/auth/landing?next=${encodeURIComponent(destination)}`,
        )
        router.refresh()
      } else if (mode === 'register') {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              locale,
              ...signupMarketingMetadata(
                marketingConsent,
                fields.get('marketingConsent') === 'on',
              ),
            },
            emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(destination)}`,
          },
        })
        if (error) throw error
        if (data.session) {
          router.push(`/auth/landing?next=${encodeURIComponent(destination)}`)
          router.refresh()
        } else setSuccess(d.verifySent)
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${base}/auth/callback?next=${encodeURIComponent(`/update-password?next=${encodeURIComponent(destination)}`)}`,
        })
        if (error) throw error
        setSuccess(d.resetSent)
      } else if (mode === 'confirm') {
        const { error } = await client.auth.resend({
          type: 'signup',
          email,
          options: {
            emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(destination)}`,
          },
        })
        if (error) throw error
        setSuccess(d.verifySent)
      } else {
        const { error } = await client.auth.updateUser({ password })
        if (error) throw error
        router.replace(`/auth/landing?next=${encodeURIComponent(destination)}`)
        router.refresh()
      }
    } catch (error) {
      setError(
        error &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 429
          ? d.sellerAccess.rateLimited
          : d.authError,
      )
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
          emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`,
        },
      })
      if (error) throw error
      setSuccess(d.verifySent)
    } catch (error) {
      setError(
        error &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 429
          ? d.sellerAccess.rateLimited
          : d.authError,
      )
    } finally {
      setBusy(false)
    }
  }
  const registrationSent = mode === 'register' && Boolean(success)
  const title =
    mode === 'login'
      ? d.login
      : mode === 'register'
        ? d.register
        : mode === 'reset'
          ? d.reset
          : mode === 'confirm'
            ? d.sellerAccess.confirmEmail
            : d.sellerAccess.choosePassword
  return (
    <div className="auth-layout" lang={intlLocale(locale)}>
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
          <select
            aria-label={d.language}
            disabled={!ready}
            value={locale}
            lang={intlLocale(locale)}
            onChange={(e) => changeLocale(e.target.value as Locale)}
          >
            {locales.map((code) => (
              <option key={code} value={code} lang={intlLocale(code)}>
                {localeNames[code]}
              </option>
            ))}
          </select>
        </div>
        <div className="auth-form">
          <div style={{ marginBottom: 35 }}>
            <Brand />
          </div>
          <h1>{title}</h1>
          {registrationStoreName &&
            (mode === 'register' || mode === 'login') && (
              <p className="registration-store-name">
                {d.selfRegistration.storeContext.replace(
                  '{store}',
                  () => registrationStoreName,
                )}
              </p>
            )}
          {mode === 'register' && destination === '/' && (
            <AdsConsentControl
              d={d}
              locale={locale}
              legalBaseUrl={legalBaseUrl}
            />
          )}
          <p>
            {(mode === 'register' || mode === 'login') &&
            destination.startsWith('/join/')
              ? d.selfRegistration.joinLogin
              : mode === 'register'
                ? d.registerIntro
                : mode === 'login'
                  ? d.loginIntro
                  : mode === 'confirm'
                    ? d.sellerAccess.confirmHint
                    : mode === 'password'
                      ? d.sellerAccess.passwordHint
                      : d.passwordHint}
          </p>
          {destination.startsWith('/invite/') &&
            (mode === 'register' || mode === 'login') && (
              <p className="notice">
                {mode === 'register'
                  ? d.invitedRegisterIntro
                  : d.invitedLoginIntro}
              </p>
            )}
          {!registrationSent && (
            <form method="post" onSubmit={submit}>
              {mode !== 'password' && (
                <div className="field">
                  <label htmlFor="email">{d.email}</label>
                  <input
                    id="email"
                    name="email"
                    disabled={!ready}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={254}
                  />
                </div>
              )}
              {mode !== 'reset' && mode !== 'confirm' && (
                <div className="field">
                  <label htmlFor="password">
                    {mode === 'password' ? d.newPassword : d.password}
                  </label>
                  <PasswordInput
                    id="password"
                    name="password"
                    disabled={!ready}
                    showLabel={d.showPassword}
                    hideLabel={d.hidePassword}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    minLength={mode === 'login' ? 1 : 10}
                    aria-describedby={
                      mode !== 'login' ? 'password-hint' : undefined
                    }
                    required
                  />
                  {mode !== 'login' && (
                    <small id="password-hint">{d.passwordHint}</small>
                  )}
                </div>
              )}
              {mode === 'login' && (
                <p
                  style={{
                    textAlign: 'right',
                    marginTop: -8,
                    marginBottom: 24,
                  }}
                >
                  <Link
                    href={`/reset-password?next=${encodeURIComponent(destination)}`}
                    className="text-link"
                  >
                    {d.forgot}
                  </Link>
                </p>
              )}
              {mode === 'register' && marketingConsent && (
                <MarketingConsentField d={d} disabled={busy || !ready} />
              )}
              <Button disabled={busy || !ready} className="full">
                {busy
                  ? d.loading
                  : mode === 'reset'
                    ? d.sendReset
                    : mode === 'confirm'
                      ? d.resend
                      : mode === 'password'
                        ? d.savePassword
                        : title}
                <ArrowRight size={16} />
              </Button>
            </form>
          )}
          <Feedback
            error={error || (callbackError ? d.callbackError : '')}
            success={registrationSent ? d.verifySent : success}
          />
          {registrationSent && (
            <Button variant="ghost" onClick={resend} disabled={busy}>
              {d.resend}
            </Button>
          )}
          {mode === 'register' && (
            <LegalLinks locale={locale} baseUrl={legalBaseUrl} d={d.legal} />
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
                href={`/login?next=${encodeURIComponent(destination)}`}
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
