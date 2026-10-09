/** Optional acquisition measurement. Never pass account, seller or store data. */
export const adsConsentCookie = 'komisio-ads-consent-v1'
export type AdsConsent = 'granted' | 'denied' | null

export function readAdsConsent(cookies: string): AdsConsent {
  const value = cookies
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${adsConsentCookie}=`))
    ?.split('=')[1]
  return value === 'granted' || value === 'denied' ? value : null
}

export function adsConfiguration(
  tag: string | undefined,
  label: string | undefined,
) {
  return tag && /^AW-\d+$/.test(tag) && label && /^[A-Za-z0-9_-]+$/.test(label)
    ? { tag, destination: `${tag}/${label}` }
    : null
}

export function adsConsentValue(
  consent: Exclude<AdsConsent, null>,
  hostname: string,
  secure: boolean,
) {
  const shared = hostname === 'komisio.com' || hostname === 'app.komisio.com'
  return `${adsConsentCookie}=${consent}; Path=/; Max-Age=15552000; SameSite=Lax${shared ? '; Domain=komisio.com' : ''}${secure ? '; Secure' : ''}`
}

export const deniedAdsConsent = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
} as const

export function conversionPayload(destination: string, requestId: string) {
  // The random creation request ID deduplicates retries; it is not a tenant ID.
  if (
    !/^AW-\d+\/[A-Za-z0-9_-]+$/.test(destination) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  )
    return null
  return {
    send_to: destination,
    transaction_id: requestId,
    page_location: 'https://app.komisio.com/onboarding',
    page_referrer: '',
    page_title: 'Store registration',
  }
}

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

export function clearAdsCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.trim().split('=')[0]
    if (!/^_gcl_[A-Za-z0-9_]+$/.test(name)) continue
    for (const domain of [
      '',
      '; Domain=komisio.com',
      `; Domain=${location.hostname}`,
    ])
      document.cookie = `${name}=; Path=/; Max-Age=0${domain}; SameSite=Lax`
  }
}

function loadConversionTag(tag: string) {
  // No tag is loaded on ordinary app visits or account/seller registration.
  // Existing, independently configured trackers are not taken over.
  if (window.gtag || window.dataLayer) return false
  window.dataLayer = []
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('consent', 'default', deniedAdsConsent)
  window.gtag('consent', 'update', {
    ...deniedAdsConsent,
    ad_storage: 'granted',
    ad_user_data: 'granted',
  })
  window.gtag('js', new Date())
  window.gtag('config', tag, {
    send_page_view: false,
    allow_ad_personalization_signals: false,
    page_location: 'https://app.komisio.com/onboarding',
    page_referrer: '',
    page_title: 'Store registration',
  })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${tag}`
  document.head.appendChild(script)
  return true
}

let conversionInFlight: Promise<boolean> | undefined

/** Only called by the successful create-store form, never account sign-up. */
export function measureStoreRegistration(requestId: string): Promise<boolean> {
  if (conversionInFlight) return conversionInFlight
  const attempt = sendStoreRegistration(requestId)
  conversionInFlight = attempt
  void attempt.finally(() => {
    conversionInFlight = undefined
  })
  return attempt
}

async function sendStoreRegistration(requestId: string): Promise<boolean> {
  let loaded = false
  try {
    const config = adsConfiguration(
      process.env.NEXT_PUBLIC_GOOGLE_ADS_ID,
      process.env.NEXT_PUBLIC_GOOGLE_ADS_STORE_LABEL,
    )
    if (!config || readAdsConsent(document.cookie) !== 'granted') return false
    const payload = conversionPayload(config.destination, requestId)
    if (!payload) return false
    const key = `komisio-ads-sent:${requestId}`
    if (sessionStorage.getItem(key)) return false
    loaded = loadConversionTag(config.tag)
    if (!loaded) return false
    sessionStorage.setItem(key, '1')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1200)
      window.gtag?.('event', 'conversion', {
        ...payload,
        event_callback: () => {
          clearTimeout(timer)
          resolve()
        },
        event_timeout: 1000,
      })
    })
  } catch {
    // Blocked storage, scripts or network must never prevent store creation.
  }
  return loaded
}
