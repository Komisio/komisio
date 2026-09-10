import sv from '@/messages/sv.json'
import en from '@/messages/en.json'
export type Dictionary = typeof sv
export type Locale = 'sv' | 'en'
export function dictionary(locale: string = 'sv'): Dictionary {
  return locale === 'en' ? en : sv
}
