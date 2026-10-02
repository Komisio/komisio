import { z } from 'zod'

export const itemLanguage = z.enum([
  'sv',
  'en',
  'no',
  'dk',
  'fi',
  'de',
  'es',
  'it',
])
export type ItemLanguage = z.infer<typeof itemLanguage>
export const itemLanguageNames: Record<ItemLanguage, string> = {
  sv: 'Swedish',
  en: 'English',
  no: 'Norwegian Bokmål',
  dk: 'Danish',
  fi: 'Finnish',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
}
