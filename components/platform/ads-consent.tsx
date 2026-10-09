'use client'

import { useState, useSyncExternalStore } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  adsConfiguration,
  adsConsentValue,
  clearAdsCookies,
  readAdsConsent,
  type AdsConsent,
} from '@/lib/platform/ads-measurement'

const config = adsConfiguration(
  process.env.NEXT_PUBLIC_GOOGLE_ADS_ID,
  process.env.NEXT_PUBLIC_GOOGLE_ADS_STORE_LABEL,
)

const consentEvent = 'komisio-ads-consent-change'
function subscribe(callback: () => void) {
  window.addEventListener(consentEvent, callback)
  window.addEventListener('focus', callback)
  return () => {
    window.removeEventListener(consentEvent, callback)
    window.removeEventListener('focus', callback)
  }
}
const snapshot = () => readAdsConsent(document.cookie)
const serverSnapshot = () => null

/** Mount only on store registration/onboarding, never seller or operational pages. */
export function AdsConsentControl({
  d,
  locale,
}: {
  d: Dictionary
  locale: string
}) {
  const consent = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const [editing, setEditing] = useState(false)
  if (!config) return null

  function choose(value: Exclude<AdsConsent, null>) {
    document.cookie = adsConsentValue(
      value,
      location.hostname,
      location.protocol === 'https:',
    )
    if (value === 'denied') clearAdsCookies()
    window.dispatchEvent(new Event(consentEvent))
    setEditing(false)
  }
  return (
    <aside className="ads-consent" aria-label={d.adsMeasurement.title}>
      {consent === null || editing ? (
        <>
          <p>
            {d.adsMeasurement.intro}{' '}
            <a
              href={`https://komisio.com/${locale === 'sv' ? 'sv' : 'en'}/privacy/`}
              target="_blank"
              rel="noreferrer"
            >
              {d.adsMeasurement.details}
            </a>
          </p>
          <div className="row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => choose('denied')}
            >
              {d.adsMeasurement.reject}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => choose('granted')}
            >
              {d.adsMeasurement.accept}
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="text-link"
          onClick={() => setEditing(true)}
        >
          {d.adsMeasurement.settings}
        </button>
      )}
    </aside>
  )
}
