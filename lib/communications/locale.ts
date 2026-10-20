import { dictionary, isLocale, type Dictionary, type Locale } from '../i18n'

/** Email language never depends on the staff session that initiated delivery. */
export function emailLocale(preferred?: unknown, store?: unknown): Locale {
  return isLocale(preferred) ? preferred : isLocale(store) ? store : 'en'
}

export function templatePlaceholders(text: string) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
}

/** Resolve an entire message before formatting its facts; never mix languages. */
export function emailTemplate(
  requested: unknown,
  read: (d: Dictionary) => Record<string, unknown> | undefined,
) {
  const english = read(dictionary('en'))
  if (
    !english ||
    !Object.keys(english).length ||
    Object.values(english).some((v) => typeof v !== 'string' || !v.trim())
  )
    throw new Error('EMAIL_TEMPLATE_MISSING')
  const locale = emailLocale(requested)
  const candidate = read(dictionary(locale))
  const complete =
    candidate &&
    Object.entries(english).every(
      ([key, source]) =>
        typeof candidate[key] === 'string' &&
        !!candidate[key].trim() &&
        JSON.stringify(templatePlaceholders(candidate[key])) ===
          JSON.stringify(templatePlaceholders(source as string)),
    )
  return {
    locale: complete ? locale : ('en' as Locale),
    copy: (complete ? candidate : english) as Record<string, string>,
  }
}
