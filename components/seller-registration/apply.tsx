'use client'
import { useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useRegistrationCommand } from './use-registration-command'
import type { RegistrationEntry } from '@/lib/engine/seller-registration'
import { intlLocale, type Dictionary } from '@/lib/i18n'

export function RegistrationApplication({
  entry,
  token,
  d,
}: {
  entry: Extract<RegistrationEntry, { state: 'form' }>
  token: string
  d: Dictionary['selfRegistration']
}) {
  const command = useRegistrationCommand(d),
    router = useRouter()
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [accepted, setAccepted] = useState(false)
  return (
    <form
      className="registration-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!accepted) return
        if (
          await command.send({
            action: 'apply',
            token,
            requestId: crypto.randomUUID(),
            name,
            phone,
            agreementId: entry.agreement.id,
            translationId: entry.agreement.translationId,
            accepted: true,
            mailSettingId: entry.mailSettingId,
          })
        ) {
          router.replace('/seller')
          router.refresh()
        }
      }}
    >
      <p>{d.applyHint}</p>
      <label htmlFor="registration-name">{d.name}</label>
      <input
        id="registration-name"
        autoComplete="name"
        required
        maxLength={120}
        value={name}
        disabled={command.locked}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor="registration-email">{d.email}</label>
      <input
        id="registration-email"
        type="email"
        value={entry.email}
        readOnly
        aria-describedby="registration-email-hint"
      />
      <p className="muted" id="registration-email-hint">
        {d.emailHint}
      </p>
      <label htmlFor="registration-phone">{d.phone}</label>
      <input
        id="registration-phone"
        type="tel"
        autoComplete="tel"
        required
        maxLength={40}
        value={phone}
        disabled={command.locked}
        onChange={(e) => setPhone(e.target.value)}
      />
      <section className="registration-agreement" aria-label={d.terms}>
        <p className="muted">{d.terms}</p>
        <h2 lang={intlLocale(entry.agreement.language)}>
          {entry.agreement.title}
        </h2>
        <div
          className="registration-terms"
          lang={intlLocale(entry.agreement.language)}
        >
          {entry.agreement.body}
        </div>
      </section>
      <label className="check">
        <input
          type="checkbox"
          checked={accepted}
          disabled={command.locked}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        {d.accept}
      </label>
      {command.error && <p role="alert">{command.error}</p>}
      <button
        className="btn btn-primary"
        disabled={
          !accepted ||
          !name.trim() ||
          !phone.trim() ||
          command.busy ||
          command.done
        }
      >
        {command.uncertain ? d.retry : d.submit}
      </button>
    </form>
  )
}
