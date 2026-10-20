import { dictionary, isLocale, type Locale } from '../i18n'
import { supportConfig } from '../help/support'

export function signupMessageLocale(input: {
  cookie?: string | null
  lang?: string | null
  acceptLanguage?: string | null
}): Locale {
  if (isLocale(input.cookie)) return input.cookie
  if (isLocale(input.lang)) return input.lang
  for (const entry of (input.acceptLanguage ?? '').split(',')) {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(';')
    if (parameters.some((part) => /^q=0(?:\.0*)?$/.test(part.trim()))) continue
    const language = tag.split('-')[0]
    const locale =
      language === 'nb' || language === 'nn'
        ? 'no'
        : language === 'da'
          ? 'dk'
          : language
    if (isLocale(locale)) return locale
  }
  return 'en'
}

export function signupBlockedMessage(
  input: Parameters<typeof signupMessageLocale>[0],
  env: Record<string, string | undefined>,
) {
  return dictionary(signupMessageLocale(input)).errors.signupBlocked.replace(
    '{email}',
    supportConfig(env).email,
  )
}
