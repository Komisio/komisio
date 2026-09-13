'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import {
  storeProfileBody,
  emptyStoreProfile,
  weekday,
  type CurrentStoreProfile,
} from '@/lib/engine/store-profile'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Owner or admin publishes the next profile version naming the current one. */
export function StoreProfileForm({
  tenantId,
  current,
  editable,
  locale,
  d,
}: {
  tenantId: string
  current: CurrentStoreProfile
  editable: boolean
  locale: 'sv' | 'en'
  d: Dictionary
}) {
  const t = d.storeProfile
  const [base] = useState(current)
  const profile = base.profile ?? emptyStoreProfile(locale)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  const action = useIntakeAction(d.intake),
    router = useRouter()
  const hours = new Map(profile.openingHours.map((h) => [h.day, h]))
  return (
    <section className="card intake-form" aria-label={t.title}>
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      <p>{base.id ? `${t.version} ${base.version}` : t.defaults}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setInvalid(false)
          const f = new FormData(e.currentTarget)
          const text = (key: string) => String(f.get(key) ?? '').trim()
          const candidate = storeProfileBody.safeParse({
            address: {
              street: text('street'),
              postalCode: text('postalCode'),
              city: text('city'),
            },
            contact: {
              email: text('email'),
              phone: text('phone'),
              website: text('website'),
            },
            openingHours: weekday.options
              .filter((day) => f.get(`open-${day}`) === 'on')
              .map((day) => ({
                day,
                opens: text(`opens-${day}`),
                closes: text(`closes-${day}`),
              })),
            accepts: text('accepts'),
            concept: text('concept'),
            language: text('language'),
          })
          if (!candidate.success) {
            setInvalid(true)
            return
          }
          if (
            await action.run({
              action: 'publishStoreProfile',
              tenantId,
              requestId,
              expectedCurrentId: base.id,
              profile: candidate.data,
            })
          ) {
            setSaved(true)
            setRequestId(crypto.randomUUID())
            router.refresh()
          }
        }}
      >
        <fieldset
          className="intake-fields"
          disabled={!editable || action.busy || action.locked || saved}
        >
          <h3>{t.address}</h3>
          {(['street', 'postalCode', 'city'] as const).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`profile-${key}`}>{t[key]}</label>
              <input
                id={`profile-${key}`}
                name={key}
                defaultValue={profile.address[key]}
                maxLength={key === 'postalCode' ? 20 : 120}
              />
            </div>
          ))}
          <h3>{t.contact}</h3>
          {(['email', 'phone', 'website'] as const).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`profile-${key}`}>{t[key]}</label>
              <input
                id={`profile-${key}`}
                name={key}
                defaultValue={profile.contact[key]}
                maxLength={key === 'email' ? 254 : key === 'phone' ? 40 : 200}
                inputMode={key === 'email' ? 'email' : undefined}
              />
            </div>
          ))}
          <h3>{t.openingHours}</h3>
          {weekday.options.map((day) => {
            const h = hours.get(day)
            return (
              <div className="row wrap" key={day}>
                <label className="intake-confirm" htmlFor={`open-${day}`}>
                  <input
                    id={`open-${day}`}
                    type="checkbox"
                    name={`open-${day}`}
                    defaultChecked={!!h}
                  />
                  {t.days[day]}
                </label>
                <label htmlFor={`opens-${day}`}>{t.opens}</label>
                <input
                  id={`opens-${day}`}
                  name={`opens-${day}`}
                  type="time"
                  defaultValue={h?.opens ?? '10:00'}
                />
                <label htmlFor={`closes-${day}`}>{t.closes}</label>
                <input
                  id={`closes-${day}`}
                  name={`closes-${day}`}
                  type="time"
                  defaultValue={h?.closes ?? '18:00'}
                />
              </div>
            )
          })}
          <div className="field">
            <label htmlFor="profile-accepts">{t.accepts}</label>
            <textarea
              id="profile-accepts"
              name="accepts"
              rows={4}
              maxLength={2000}
              defaultValue={profile.accepts}
            />
          </div>
          <div className="field">
            <label htmlFor="profile-concept">{t.concept}</label>
            <textarea
              id="profile-concept"
              name="concept"
              rows={4}
              maxLength={2000}
              defaultValue={profile.concept}
            />
          </div>
          <div className="field">
            <label htmlFor="profile-language">{t.language}</label>
            <select
              id="profile-language"
              name="language"
              defaultValue={profile.language}
            >
              <option value="sv">sv</option>
              <option value="en">en</option>
            </select>
          </div>
        </fieldset>
        {invalid && <p role="alert">{t.invalid}</p>}
        {action.error && <p role="alert">{action.error}</p>}
        {action.needsReload && <p role="alert">{t.changed}</p>}
        {!editable && <p>{t.readOnly}</p>}
        {editable && !saved && (
          <Button type="submit" disabled={action.busy || action.needsReload}>
            {action.busy
              ? d.intake.busy
              : action.locked
                ? d.intake.retry
                : t.publish}
          </Button>
        )}
        {saved && <p role="status">{t.published}</p>}
      </form>
    </section>
  )
}
