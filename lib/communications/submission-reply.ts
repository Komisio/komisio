import { dictionary, type Locale } from '../i18n'
import { plainText } from './templates'
export function renderSubmissionReply(
  locale: Locale,
  storeName: string,
  sellerId: string,
  appUrl: string,
) {
  const base = new URL(appUrl)
  if (!['http:', 'https:'].includes(base.protocol))
    throw new Error('INVALID_INPUT')
  const link = new URL('/seller/submissions', base.origin)
  link.searchParams.set('seller', sellerId)
  const d = dictionary(locale).submissions
  const values: Record<string, string> = {
    store: plainText(storeName),
    url: link.href,
  }
  return {
    templateKey: 'seller.submission_reply',
    templateVersion: 'v1',
    subject: d.replySubject
      .replace('{store}', plainText(storeName).replace(/\n/g, ' '))
      .slice(0, 200),
    body: d.replyBody.replace(
      /\{(store|url)\}/g,
      (_, key: string) => values[key],
    ),
  }
}
