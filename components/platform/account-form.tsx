'use client'
import { useState } from 'react'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
import { Button } from '@/components/ui/button'
import { browserClient } from '@/lib/supabase/client'
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
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const result = await action.run({
      action: 'profile',
      name: form.get('name'),
      locale: form.get('locale'),
    })
    if (result) {
      document.cookie = `komisio-locale=${form.get('locale')};path=/;SameSite=Lax`
      document.documentElement.lang = String(form.get('locale'))
      action.router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="profile-name">{d.displayName}</label>
        <input
          id="profile-name"
          name="name"
          defaultValue={name}
          maxLength={100}
          autoComplete="name"
        />
      </div>
      <div className="field">
        <label htmlFor="profile-email">{d.email}</label>
        <input id="profile-email" value={email} readOnly />
      </div>
      <div className="field">
        <label htmlFor="profile-language">{d.language}</label>
        <select id="profile-language" name="locale" defaultValue={locale}>
          {locales.map((code) => (
            <option key={code} value={code}>
              {localeNames[code]}
            </option>
          ))}
        </select>
      </div>
      <Button disabled={action.busy}>{d.save}</Button>
      <Feedback error={action.error} success={action.success} />
    </form>
  )
}
export function PasswordForm({ d }: { d: Dictionary }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        const form = e.currentTarget
        const fields = new FormData(form)
        try {
          const { error } = await browserClient().auth.updateUser({
            password: String(fields.get('password')),
          })
          if (error) throw error
          setSaved(true)
          form.reset()
        } catch {
          setError(d.authError)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="field">
        <label htmlFor="new-password">{d.newPassword}</label>
        <input
          id="new-password"
          name="password"
          type="password"
          minLength={10}
          required
          autoComplete="new-password"
        />
        <small>{d.passwordHint}</small>
      </div>
      <Button variant="secondary" disabled={busy}>
        {d.savePassword}
      </Button>
      <Feedback error={error} success={saved ? d.saved : ''} />
    </form>
  )
}
