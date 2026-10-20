import { isLocale, type Dictionary, type Locale } from '../i18n'
import { emailTemplate } from '../communications/locale'

export const authEmailActions = [
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email_change',
  'reauthentication',
  'password_changed_notification',
  'email_changed_notification',
  'phone_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'mfa_factor_enrolled_notification',
  'mfa_factor_unenrolled_notification',
] as const satisfies readonly (keyof Dictionary['authEmail'])[]
export type AuthEmailAction = (typeof authEmailActions)[number]

/** Person-owned preference. Never infer account language from a staff/store session. */
export function authEmailLocale(
  metadata: Record<string, unknown> | null | undefined,
): Locale {
  return isLocale(metadata?.product_locale)
    ? metadata.product_locale
    : isLocale(metadata?.locale)
      ? metadata.locale
      : 'en'
}

export function authEmailCopy(locale: unknown, action: string) {
  if (!(authEmailActions as readonly string[]).includes(action)) return null
  return emailTemplate(locale, (d) => d.authEmail?.[action as AuthEmailAction])
}
