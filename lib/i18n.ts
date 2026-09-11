import sv from '../messages/sv.json'
import en from '../messages/en.json'
export type Dictionary = typeof sv
export type Locale = 'sv' | 'en'
export function resolveLocale(
  browserLocale?: string,
  profileLocale?: string,
): Locale {
  if (browserLocale === 'sv' || browserLocale === 'en') return browserLocale
  return profileLocale === 'en' ? 'en' : 'sv'
}
export function dictionary(locale: string = 'sv'): Dictionary {
  return locale === 'en' ? en : sv
}
