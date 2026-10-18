'use client'
import { useState } from 'react'
import Link from '@/components/platform/working-link'
import { useRouter } from '@/components/platform/use-working-router'
import { EventTime } from '@/components/ui/event-time'
import { useRegistrationCommand } from './use-registration-command'
import type { StoreRegistration } from '@/lib/engine/seller-registration'
import { intlLocale, type Dictionary, type Locale } from '@/lib/i18n'

export function RegistrationReview({
  entry,
  tenantId,
  locale,
  d,
}: {
  entry: StoreRegistration
  tenantId: string
  locale: Locale
  d: Dictionary['selfRegistration']
}) {
  const command = useRegistrationCommand(d),
    router = useRouter()
  const [selected, setSelected] = useState<boolean | null>(null)
  async function review(approved: boolean) {
    if (!approved && !command.uncertain && !window.confirm(d.rejectConfirm))
      return
    setSelected(approved)
    if (
      await command.send({
        action: 'review',
        tenantId,
        requestId: crypto.randomUUID(),
        registrationId: entry.id,
        approved,
      })
    )
      router.refresh()
  }
  return (
    <article className="card registration-review" aria-label={entry.name}>
      <h2>{entry.name}</h2>
      <p className="muted">
        <EventTime value={entry.createdAt} locale={locale} />
      </p>
      <dl>
        <dt>{d.email}</dt>
        <dd>{entry.email}</dd>
        <dt>{d.phone}</dt>
        <dd>{entry.phone}</dd>
      </dl>
      <details>
        <summary>{d.reviewTerms}</summary>
        <h3 lang={intlLocale(entry.agreement.language)}>
          {entry.agreement.title}
        </h3>
        <div
          className="registration-terms"
          lang={intlLocale(entry.agreement.language)}
        >
          {entry.agreement.body}
        </div>
      </details>
      {entry.matches === 1 && <p>{d.reuse}</p>}
      {entry.matches > 1 && (
        <p role="status">
          {d.ambiguous}{' '}
          <Link href={`/intake/sellers?q=${encodeURIComponent(entry.email)}`}>
            {d.email}
          </Link>
        </p>
      )}
      {entry.emailChanged && <p role="status">{d.emailChanged}</p>}
      <div className="actions">
        <button
          className="btn btn-primary"
          disabled={
            command.busy ||
            command.done ||
            entry.matches > 1 ||
            entry.emailChanged ||
            (command.uncertain && selected !== true)
          }
          onClick={() => void review(true)}
        >
          {command.uncertain && selected ? d.retry : d.approve}
        </button>
        <button
          className="btn btn-secondary"
          disabled={
            command.busy ||
            command.done ||
            (command.uncertain && selected !== false)
          }
          onClick={() => void review(false)}
        >
          {command.uncertain && selected === false ? d.retry : d.reject}
        </button>
      </div>
      {command.error && <p role="alert">{command.error}</p>}
      {command.done && <p role="status">{d.saved}</p>}
    </article>
  )
}
