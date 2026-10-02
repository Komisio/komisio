'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { type Dictionary, type Locale, locales, localeNames } from '@/lib/i18n'
import {
  storeProfileBody,
  emptyStoreProfile,
  weekday,
  type CurrentStoreProfile,
} from '@/lib/engine/store-profile'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useFormDirty } from '@/components/platform/use-form-dirty'

function OpeningHoursRow({
  day,
  initial,
  d,
}: {
  day: (typeof weekday.options)[number]
  initial?: { opens: string; closes: string }
  d: Dictionary['storeProfile']
}) {
  const [included, setIncluded] = useState(Boolean(initial))
  return (
    <div
      className="profile-hours-row"
      role="group"
      aria-labelledby={`profile-day-${day}`}
    >
      <div className="profile-hours-day">
        <label
          className="intake-confirm"
          id={`profile-day-${day}`}
          htmlFor={`open-${day}`}
        >
          <input
            id={`open-${day}`}
            type="checkbox"
            name={`open-${day}`}
            checked={included}
            onChange={(event) => setIncluded(event.target.checked)}
          />
          {d.days[day]}
        </label>
        {!included && <small>{d.noHours}</small>}
      </div>
      <div className="profile-hours-times" hidden={!included}>
        <div className="field">
          <label htmlFor={`opens-${day}`}>{d.opens}</label>
          <input
            id={`opens-${day}`}
            name={`opens-${day}`}
            type="time"
            defaultValue={initial?.opens ?? '10:00'}
            disabled={!included}
          />
        </div>
        <div className="field">
          <label htmlFor={`closes-${day}`}>{d.closes}</label>
          <input
            id={`closes-${day}`}
            name={`closes-${day}`}
            type="time"
            defaultValue={initial?.closes ?? '18:00'}
            disabled={!included}
          />
        </div>
      </div>
    </div>
  )
}

/** Owner or admin publishes the next profile version naming the current one. */
export function StoreProfileForm({
  tenantId,
  countryOptions,
  current,
  editable,
  locale,
  d,
}: {
  countryOptions: { code: string; label: string }[]
  tenantId: string
  current: CurrentStoreProfile
  editable: boolean
  locale: Locale
  d: Dictionary
}) {
  const t = d.storeProfile
  const [base] = useState(current)
  const profile = base.profile ?? emptyStoreProfile(locale)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  const submittedFields = useRef<FormData | null>(null)
  const action = useIntakeAction(d.intake),
    router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const { dirty, checkDirty } = useFormDirty(form)
  useUnsavedChanges(
    editable && !saved && (dirty || action.locked) ? d.leaveUnsaved : null,
  )
  const hours = new Map(profile.openingHours.map((h) => [h.day, h]))
  return (
    <section
      className="card intake-form store-profile-editor"
      aria-label={t.title}
    >
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      <p>{base.id ? `${t.version} ${base.version}` : t.defaults}</p>
      <form
        ref={form}
        onChange={checkDirty}
        onSubmit={async (e) => {
          e.preventDefault()
          if (action.busy || action.needsReload) return
          setInvalid(false)
          // Locked fields are omitted by FormData. Validate the submitted
          // values while the action retains the original publication identity.
          const f =
            action.locked && submittedFields.current
              ? submittedFields.current
              : new FormData(e.currentTarget)
          const text = (key: string) => String(f.get(key) ?? '').trim()
          const candidate = storeProfileBody.safeParse({
            address: {
              street: text('street'),
              postalCode: text('postalCode'),
              city: text('city'),
              country: text('country'),
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
          submittedFields.current = f
          if (
            await action.run({
              action: 'publishStoreProfile',
              tenantId,
              requestId,
              expectedCurrentId: base.id,
              profile: candidate.data,
            })
          ) {
            submittedFields.current = null
            setSaved(true)
            setRequestId(crypto.randomUUID())
            router.refresh()
          }
        }}
      >
        <fieldset
          className="intake-fields"
          disabled={
            !editable ||
            action.busy ||
            action.locked ||
            action.needsReload ||
            saved
          }
        >
          <h3>{t.address}</h3>
          <div className="profile-field-grid">
            {(['street', 'postalCode', 'city'] as const).map((key) => (
              <div
                className={`field ${key === 'street' ? 'profile-field-wide' : ''}`}
                key={key}
              >
                <label htmlFor={`profile-${key}`}>{t[key]}</label>
                <input
                  id={`profile-${key}`}
                  name={key}
                  defaultValue={profile.address[key]}
                  maxLength={key === 'postalCode' ? 20 : 120}
                />
              </div>
            ))}
            <div className="field profile-field-wide">
              <label htmlFor="profile-country">{t.country}</label>
              <select
                id="profile-country"
                name="country"
                defaultValue={profile.address.country ?? 'SE'}
              >
                {countryOptions.map(({ code, label }) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <small>{t.countryHelp}</small>
            </div>
          </div>
          <h3>{t.contact}</h3>
          <div className="profile-field-grid">
            {(['email', 'phone', 'website'] as const).map((key) => (
              <div
                className={`field ${key === 'website' ? 'profile-field-wide' : ''}`}
                key={key}
              >
                <label htmlFor={`profile-${key}`}>{t[key]}</label>
                <input
                  id={`profile-${key}`}
                  name={key}
                  defaultValue={profile.contact[key]}
                  maxLength={key === 'email' ? 254 : key === 'phone' ? 40 : 200}
                  inputMode={
                    key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'url'
                  }
                />
              </div>
            ))}
          </div>
          <h3>{t.openingHours}</h3>
          <p>{t.hoursHint}</p>
          <div className="profile-hours">
            {weekday.options.map((day) => (
              <OpeningHoursRow
                key={day}
                day={day}
                initial={hours.get(day)}
                d={t}
              />
            ))}
          </div>
          <div className="profile-field-grid">
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
                {locales.map((code) => (
                  <option key={code} value={code}>
                    {localeNames[code]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
        {invalid && <p role="alert">{t.invalid}</p>}
        {action.error && <p role="alert">{action.error}</p>}
        {action.needsReload && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            {d.intake.reload}
          </Button>
        )}
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
