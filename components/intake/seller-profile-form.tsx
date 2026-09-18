'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { locales, localeNames, type Dictionary } from '@/lib/i18n'
import {
  sellerProfileBody,
  type SellerProfile,
} from '@/lib/engine/seller-profile'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

export function SellerProfileForm({
  tenantId,
  sellerId,
  revision,
  profile,
  d,
  intake,
  storeLanguage,
}: {
  tenantId: string
  sellerId: string
  revision: number
  profile: SellerProfile
  d: Dictionary['sellerDetails']
  intake: Dictionary['intake']
  storeLanguage: string
}) {
  const action = useIntakeAction(intake),
    router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState(false),
    [invalid, setInvalid] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const parsed = sellerProfileBody.safeParse(
      Object.fromEntries(
        Object.keys(profile).map((k) => [k, String(data.get(k) ?? '').trim()]),
      ),
    )
    if (!action.locked && !parsed.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const id = await action.run(
      action.locked
        ? {}
        : {
            action: 'saveSellerProfile',
            tenantId,
            sellerId,
            requestId,
            expectedRevision: revision,
            profile: parsed.success ? parsed.data : profile,
          },
    )
    if (id) {
      setSaved(true)
      router.refresh()
    }
  }
  const field = (
    key: keyof SellerProfile,
    label: string,
    maxLength: number,
    type = 'text',
    required = false,
  ) => (
    <div className="field" key={key}>
      <label htmlFor={`seller-profile-${key}`}>{label}</label>
      <input
        id={`seller-profile-${key}`}
        name={key}
        type={type}
        required={required}
        maxLength={maxLength}
        defaultValue={profile[key]}
      />
    </div>
  )
  return (
    <form onSubmit={submit}>
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || action.needsReload || saved}
      >
        {field('name', intake.name, 120, 'text', true)}
        <div className="seller-profile-fields">
          {field('email', intake.email, 254, 'email')}
          {field('phone', intake.phone, 40, 'tel')}
        </div>
        <small>{intake.contactHint}</small>
        <p>
          <small>{d.emailHint}</small>
        </p>
        <details className="seller-disclosure">
          <summary>{d.address}</summary>
          <div className="seller-disclosure-body">
            {field('addressLine1', d.street, 160)}
            {field('addressLine2', d.addressExtra, 160)}
            <div className="seller-profile-fields">
              {field('postalCode', d.postalCode, 24)}
              {field('city', d.city, 120)}
            </div>
            {field('country', d.country, 80)}
          </div>
        </details>
        <details className="seller-disclosure">
          <summary>{d.preferences}</summary>
          <div className="seller-disclosure-body">
            <div className="field">
              <label htmlFor="seller-profile-language">{d.language}</label>
              <select
                id="seller-profile-language"
                name="language"
                defaultValue={profile.language}
              >
                <option value="">
                  {d.followStore} ({storeLanguage})
                </option>
                {locales.map((l) => (
                  <option key={l} value={l}>
                    {localeNames[l]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="seller-profile-notes">{d.notes}</label>
              <textarea
                id="seller-profile-notes"
                name="notes"
                maxLength={1000}
                defaultValue={profile.notes}
              />
              <small>{d.notesHint}</small>
            </div>
          </div>
        </details>
      </fieldset>
      {(invalid || action.error) && (
        <p role="alert">{invalid ? intake.invalid : action.error}</p>
      )}
      {action.needsReload && (
        <a className="text-link" href={`/intake/sellers/${sellerId}`}>
          {intake.reload}
        </a>
      )}
      {saved ? (
        <p role="status">{d.saved}</p>
      ) : (
        <Button type="submit" disabled={action.busy || action.needsReload}>
          {action.busy ? intake.busy : action.locked ? intake.retry : d.save}
        </Button>
      )}
    </form>
  )
}
