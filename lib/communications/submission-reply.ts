import { type Locale } from '../i18n'
import { emailTemplate } from './locale'
import { plainText } from './templates'
export function renderSubmissionReply(
  requestedLocale: Locale,
  storeName: string,
  sellerId: string,
  appUrl: string,
) {
  const { locale, copy } = emailTemplate(requestedLocale, (d) => ({
    subject: d.submissions?.replySubject,
    body: d.submissions?.replyBody,
  }))
  const base = new URL(appUrl)
  if (!['http:', 'https:'].includes(base.protocol))
    throw new Error('INVALID_INPUT')
  const link = new URL('/seller/submissions', base.origin)
  link.searchParams.set('seller', sellerId)
  const values: Record<string, string> = {
    store: plainText(storeName),
    url: link.href,
  }
  return {
    locale,
    templateKey: 'seller.submission_reply',
    templateVersion: 'v1',
    subject: copy.subject
      .replace('{store}', plainText(storeName).replace(/\n/g, ' '))
      .slice(0, 200),
    body: copy.body.replace(
      /\{(store|url)\}/g,
      (_, key: string) => values[key],
    ),
  }
}
