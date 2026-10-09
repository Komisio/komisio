import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adsConfiguration,
  adsConsentValue,
  conversionPayload,
  measureStoreRegistration,
  readAdsConsent,
} from '../../lib/platform/ads-measurement'

const requestId = '452d5297-f268-4b85-8262-2bc5691bf781'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('optional store acquisition measurement', () => {
  it('requires a configured destination and explicit versioned consent', () => {
    expect(adsConfiguration('AW-123', '')).toBeNull()
    expect(adsConfiguration('https://example.com', 'abc')).toBeNull()
    expect(readAdsConsent('other=granted')).toBeNull()
    expect(readAdsConsent('komisio-ads-consent-v1=true')).toBeNull()
    expect(readAdsConsent('other=1; komisio-ads-consent-v1=denied')).toBe(
      'denied',
    )
    expect(readAdsConsent('komisio-ads-consent-v1=granted')).toBe('granted')
    expect(
      adsConsentValue('denied', 'preview.example.com', true),
    ).not.toContain('Domain=')
    expect(adsConsentValue('granted', 'app.komisio.com', true)).toContain(
      'Domain=komisio.com; Secure',
    )
  })
  it('uses only a random deduplication ID and fixed public metadata', () => {
    expect(conversionPayload('AW-123/abc', requestId)).toEqual({
      send_to: 'AW-123/abc',
      transaction_id: requestId,
      page_location: 'https://app.komisio.com/onboarding',
      page_referrer: '',
      page_title: 'Store registration',
    })
    expect(conversionPayload('AW-123/abc', 'email@example.com')).toBeNull()
  })
  it('sends nothing without consent and deduplicates successful request retries', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_ADS_ID', 'AW-123')
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_ADS_STORE_LABEL', 'abc')
    vi.useFakeTimers()
    const browser: { dataLayer?: IArguments[] } = {}
    vi.stubGlobal('window', browser)
    const append = vi.fn()
    const doc = {
      cookie: '',
      createElement: vi.fn(() => ({})),
      head: { appendChild: append },
    }
    vi.stubGlobal('document', doc)
    const storage = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storage.get(k),
      setItem: (k: string, v: string) => storage.set(k, v),
    })
    await measureStoreRegistration(requestId)
    expect(append).not.toHaveBeenCalled()
    doc.cookie = 'komisio-ads-consent-v1=granted'
    const attempt = measureStoreRegistration(requestId)
    expect(measureStoreRegistration(requestId)).toBe(attempt)
    await vi.advanceTimersByTimeAsync(1201)
    expect(await attempt).toBe(true)
    await measureStoreRegistration(requestId)
    expect(append).toHaveBeenCalledTimes(1)
    const events = browser.dataLayer!.map((args) => Array.from(args))
    expect(events[0]).toEqual([
      'consent',
      'default',
      expect.objectContaining({ ad_storage: 'denied' }),
    ])
    expect(events.filter((args) => args[1] === 'conversion')).toHaveLength(1)
  })
  it('does not block store creation when browser storage is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_ADS_ID', 'AW-123')
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_ADS_STORE_LABEL', 'abc')
    const gtag = vi.fn()
    vi.stubGlobal('window', { gtag })
    vi.stubGlobal('document', { cookie: 'komisio-ads-consent-v1=granted' })
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    await expect(measureStoreRegistration(requestId)).resolves.toBe(false)
    expect(gtag).not.toHaveBeenCalled()
  })
})
