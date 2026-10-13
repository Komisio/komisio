import { dictionary, type Locale } from '../i18n'
import { plainText } from './templates'

export function renderSellerWelcome(
  locale: Locale,
  storeName: string,
  sellerName: string,
  appUrl: string,
  branded = true,
) {
  const base = new URL(appUrl)
  if (!['http:', 'https:'].includes(base.protocol))
    throw new Error('INVALID_INPUT')
  const link = new URL('/login', base.origin)
  link.searchParams.set('next', '/seller')
  link.searchParams.set('locale', locale)
  const values: Record<string, string> = {
    store: plainText(storeName).replace(/\n/g, ' '),
    seller: plainText(sellerName).replace(/\n/g, ' '),
    url: link.href,
    activation: dictionary(locale).sellerActivation.confirm,
  }
  const fill = (text: string) =>
    text.replace(
      /\{(store|seller|url|activation)\}/g,
      (_, key: string) => values[key],
    )
  const d = dictionary(locale).communications
  return {
    templateKey: 'seller.welcome',
    // The email hook uses this frozen copy, adding only the secret button URL.
    templateVersion: branded ? 'v3' : 'v2',
    subject: fill(d.welcomeSubject).slice(0, 200),
    body: branded
      ? fill(d.activationBody) +
        '\n\n' +
        dictionary(locale).sellerActivation.emailNote
      : fill(d.welcomeBody),
  }
}
