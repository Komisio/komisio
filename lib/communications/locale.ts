import { dictionary, isLocale, type Dictionary, type Locale } from '../i18n'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readStoreProfile } from '../engine/store-profile'
import { readStorePolicy } from '../engine/store-policy'

/** Email language never depends on the staff session that initiated delivery. */
export function emailLocale(
  preferred?: unknown,
  store?: unknown,
  fallback?: unknown,
): Locale {
  return isLocale(preferred)
    ? preferred
    : isLocale(store)
      ? store
      : isLocale(fallback)
        ? fallback
        : 'en'
}

/** Read only saved store choices; an unsaved profile or staff UI cannot select mail language. */
export async function resolveSellerEmailLocale(
  client: SupabaseClient,
  tenantId: string,
  sellerProfile?: { language?: unknown } | null,
): Promise<Locale> {
  if (isLocale(sellerProfile?.language)) return sellerProfile.language
  const store = await readStoreProfile(client, tenantId)
  if (isLocale(store.profile?.language)) return store.profile.language
  const policy = await readStorePolicy(client, tenantId)
  return emailLocale(undefined, undefined, policy.policy.communicationLanguage)
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
  // Invalid template identifiers still fall back to English; this is not a store default.
  const locale = isLocale(requested) ? requested : 'en'
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
