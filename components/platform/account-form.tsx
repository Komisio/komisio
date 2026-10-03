'use client'
import { useRef, useState, useSyncExternalStore } from 'react'
import { useFormDirty } from './use-form-dirty'
import { useUnsavedChanges } from './navigation-warning'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
import { Button } from '@/components/ui/button'
import { browserClient } from '@/lib/supabase/client'
import { PasswordInput } from '@/components/auth/password-input'
import {
  intlLocale,
  localeNames,
  locales,
  type Dictionary,
  type Locale,
} from '@/lib/i18n'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

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
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const action = useCommand(d)
  const [edited, setEdited] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const { dirty, checkDirty, resetDirty } = useFormDirty(formRef, [
    ['name', name],
    ['locale', locale],
  ])
  useUnsavedChanges(dirty ? d.leaveUnsaved : null)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!ready || action.busy) return
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
      resetDirty(form)
      document.cookie = `komisio-locale=${form.get('locale')};path=/;SameSite=Lax`
      document.documentElement.lang = intlLocale(String(form.get('locale')))
      action.router.refresh()
    }
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onChange={() => {
        setEdited(true)
        checkDirty()
      }}
    >
      <div className="field">
        <label htmlFor="profile-name">{d.displayName}</label>
        <input
          id="profile-name"
          name="name"
          defaultValue={name}
          maxLength={100}
          autoComplete="name"
          disabled={!ready || action.busy}
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
          disabled={!ready || action.busy}
        >
          {locales.map((code) => (
            <option key={code} value={code}>
              {localeNames[code]}
            </option>
          ))}
        </select>
      </div>
      <Button disabled={!ready || action.busy}>{d.save}</Button>
      <Feedback error={action.error} success={edited ? '' : action.success} />
    </form>
  )
}
export function PasswordForm({ d }: { d: Dictionary }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [passwordVersion, setPasswordVersion] = useState(0)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!ready || busy) return
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
          disabled={!ready || busy}
          aria-describedby="new-password-hint"
          onChange={() => setSaved(false)}
        />
        <small id="new-password-hint">{d.passwordHint}</small>
      </div>
      <Button variant="secondary" disabled={!ready || busy}>
        {d.savePassword}
      </Button>
      <Feedback error={error} success={saved ? d.saved : ''} />
    </form>
  )
}
