import { type Locale } from '../i18n'
import { emailTemplate } from './locale'
import { plainText } from './templates'

export function renderSellerWelcome(
  requestedLocale: Locale,
  storeName: string,
  sellerName: string,
  appUrl: string,
  branded = true,
) {
  const { locale, copy } = emailTemplate(requestedLocale, (d) => ({
    subject: d.communications?.welcomeSubject,
    body: branded
      ? d.communications?.activationBody
      : d.communications?.welcomeBody,
    activation: d.sellerActivation?.confirm,
    note: d.sellerActivation?.emailNote,
  }))
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
    activation: copy.activation,
  }
  const fill = (text: string) =>
    text.replace(
      /\{(store|seller|url|activation)\}/g,
      (_, key: string) => values[key],
    )
  return {
    locale,
    templateKey: 'seller.welcome',
    // The email hook uses this frozen copy, adding only the secret button URL.
    templateVersion: branded ? 'v3' : 'v2',
    subject: fill(copy.subject).slice(0, 200),
    body: branded ? fill(copy.body) + '\n\n' + copy.note : fill(copy.body),
  }
}
