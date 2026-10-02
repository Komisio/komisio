'use client'
import { useState } from 'react'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
import { Button } from '@/components/ui/button'
import { browserClient } from '@/lib/supabase/client'
import { PasswordInput } from '@/components/auth/password-input'
import { localeNames, locales, type Dictionary, type Locale } from '@/lib/i18n'
export function AccountForm({
  d,
  name,
  email,
  locale,
}: {
  d: Dictionary
  name: string
  email: string
  locale: Locale
}) {
  const action = useCommand(d)
  const [edited, setEdited] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (action.busy) return
    setEdited(false)
    const form = new FormData(e.currentTarget)
    const result = await action.run(
      {
        action: 'profile',
        name: form.get('name'),
        locale: form.get('locale'),
      },
      // Refresh once, after the confirmed language is also in the cookie.
      { refresh: false },
    )
    if (result) {
      document.cookie = `komisio-locale=${form.get('locale')};path=/;SameSite=Lax`
      document.documentElement.lang = String(form.get('locale'))
      action.router.refresh()
    }
  }
  return (
    <form onSubmit={submit} onChange={() => setEdited(true)}>
      <div className="field">
        <label htmlFor="profile-name">{d.displayName}</label>
        <input
          id="profile-name"
          name="name"
          defaultValue={name}
          maxLength={100}
          autoComplete="name"
          disabled={action.busy}
        />
      </div>
      <div className="field">
        <label htmlFor="profile-email">{d.email}</label>
        <input id="profile-email" value={email} readOnly />
      </div>
      <div className="field">
        <label htmlFor="profile-language">{d.language}</label>
        <select
          id="profile-language"
          name="locale"
          defaultValue={locale}
          disabled={action.busy}
        >
          {locales.map((code) => (
            <option key={code} value={code}>
              {localeNames[code]}
            </option>
          ))}
        </select>
      </div>
      <Button disabled={action.busy}>{d.save}</Button>
      <Feedback error={action.error} success={edited ? '' : action.success} />
    </form>
  )
}
export function PasswordForm({ d }: { d: Dictionary }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [passwordVersion, setPasswordVersion] = useState(0)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        setError('')
        setSaved(false)
        const form = e.currentTarget
        const fields = new FormData(form)
        try {
          const { error } = await browserClient().auth.updateUser({
            password: String(fields.get('password')),
          })
          if (error) throw error
          setSaved(true)
          form.reset()
          setPasswordVersion((version) => version + 1)
        } catch {
          setError(d.authError)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="field">
        <label htmlFor="new-password">{d.newPassword}</label>
        <PasswordInput
          key={passwordVersion}
          id="new-password"
          name="password"
          showLabel={d.showPassword}
          hideLabel={d.hidePassword}
          minLength={10}
          required
          autoComplete="new-password"
          disabled={busy}
          aria-describedby="new-password-hint"
          onChange={() => setSaved(false)}
        />
        <small id="new-password-hint">{d.passwordHint}</small>
      </div>
      <Button variant="secondary" disabled={busy}>
        {d.savePassword}
      </Button>
      <Feedback error={error} success={saved ? d.saved : ''} />
    </form>
  )
}
