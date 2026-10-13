import { dictionary, type Locale } from '../i18n'
import { plainText } from './templates'

export function renderSellerWelcome(
  locale: Locale,
  storeName: string,
  sellerName: string,
  appUrl: string,
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
  }
  const fill = (text: string) =>
    text.replace(/\{(store|seller|url)\}/g, (_, key: string) => values[key])
  const d = dictionary(locale).communications
  return {
    templateKey: 'seller.welcome',
    // The log is a token-free notice. Auth renders the actual activation mail;
    // its secret link must never appear in staff-readable communication history.
    templateVersion: 'v2',
    subject: fill(d.welcomeSubject).slice(0, 200),
    body: fill(d.welcomeBody),
  }
}
