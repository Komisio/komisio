import sv from '../messages/sv.json'
import en from '../messages/en.json'
import no from '../messages/no.json'
import dk from '../messages/dk.json'
import fi from '../messages/fi.json'
import de from '../messages/de.json'
import es from '../messages/es.json'
import it from '../messages/it.json'

// The product speaks the same eight languages as komisio.com. Swedish is the
// source of truth for the dictionary shape; every other file carries the same
// keys (tests/unit/platform.test.ts). Seller e-mail templates and the
// invitation mail exist in Swedish and English only; other locales get English
// there (messageLocale).
export type Dictionary = typeof sv
export const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
export type Locale = (typeof locales)[number]
export const localeNames: Record<Locale, string> = {
  sv: 'Svenska',
  en: 'English',
  no: 'Norsk',
  dk: 'Dansk',
  fi: 'Suomi',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
}
const intlTags: Record<Locale, string> = {
  sv: 'sv-SE',
  en: 'en-GB',
  no: 'nb-NO',
  dk: 'da-DK',
  fi: 'fi-FI',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
}
const dictionaries: Record<Locale, Dictionary> = {
  sv,
  en: en as Dictionary,
  no: no as Dictionary,
  dk: dk as Dictionary,
  fi: fi as Dictionary,
  de: de as Dictionary,
  es: es as Dictionary,
  it: it as Dictionary,
}
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (locales as readonly string[]).includes(value)
  )
}
export function resolveLocale(
  browserLocale?: string | null,
  profileLocale?: string | null,
): Locale {
  if (isLocale(browserLocale)) return browserLocale
  if (isLocale(profileLocale)) return profileLocale
  return 'sv'
}
export function dictionary(locale: string = 'sv'): Dictionary {
  return dictionaries[isLocale(locale) ? locale : 'sv']
}
/** BCP 47 tag for Intl formatting of dates and numbers. */
export function intlLocale(locale?: string | null) {
  return intlTags[isLocale(locale) ? locale : 'sv']
}
/** The language a fixed e-mail template exists in. */
export function messageLocale(locale?: string | null): 'sv' | 'en' {
  return locale === 'sv' ? 'sv' : 'en'
}
