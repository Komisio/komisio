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
  const link = new URL('/register', base.origin)
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
    templateVersion: 'v1',
    subject: fill(d.welcomeSubject).slice(0, 200),
    body: fill(d.welcomeBody),
  }
}
