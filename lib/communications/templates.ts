import { storeCurrencies } from '../platform/currencies'
import { z } from 'zod'
import { intlLocale } from '../i18n'
import { emailTemplate } from './locale'

// Seller messages (P2 S18): versioned templates as code with fixed wording and
// placeholders. Plain text only, so a store name, an item label or the free
// text block can never inject links or markup. The model or staff may write
// the free-text block; the template around it does not change.
export const communicationKind = z.enum([
  'item_accepted',
  'item_sold',
  'payout_approved',
  'payout_paid',
  'statement_issued',
  'message',
])
export type CommunicationKind = z.infer<typeof communicationKind>
export const TEMPLATE_VERSION = 'v2'

export const messageFacts = z.strictObject({
  storeName: z.string().trim().min(1).max(120),
  sellerName: z.string().trim().min(1).max(120),
  amount: z
    .string()
    .regex(/^-?\d+\.\d{2}$/)
    .optional(),
  currency: z.enum(storeCurrencies).optional(),
  selfBilling: z.boolean().optional(),
  statementKind: z.enum(['statement', 'credit_note']).optional(),
  number: z.number().int().positive().optional(),
  date: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional(),
  itemLabel: z.string().trim().max(120).optional(),
  freeText: z.string().max(1000).default(''),
})
export type MessageFacts = z.infer<typeof messageFacts>

/** Removes control characters and collapses whitespace; the block stays plain text. */
export function plainText(input: string) {
  return input
    .replace(/[^\P{C}\n]/gu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** All optional parts are complete translated sentences, never sentence fragments. */
export function renderSellerMessage(
  kindInput: unknown,
  localeInput: string,
  factsInput: unknown,
) {
  const kind = communicationKind.parse(kindInput)
  const facts = messageFacts.parse(factsInput)
  const { locale, copy } = emailTemplate(localeInput, (d) => ({
    ...d.communications.templates?.[
      kind === 'statement_issued' && facts.selfBilling
        ? facts.statementKind === 'credit_note'
          ? 'self_billing_credit_issued'
          : 'self_billing_issued'
        : kind
    ],
    footer: d.communications.templates?.footer,
  }))
  const amount =
    facts.amount === undefined
      ? ''
      : (
          new Intl.NumberFormat(intlLocale(locale), {
            style: 'currency',
            currency: facts.currency ?? 'SEK',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format as (value: string) => string
        )(facts.amount)
  const date = facts.date
    ? new Date(facts.date).toLocaleDateString(intlLocale(locale), {
        timeZone: 'Europe/Stockholm',
      })
    : ''
  const values: Record<string, string> = Object.fromEntries(
    Object.entries({
      store: facts.storeName,
      seller: facts.sellerName,
      item: facts.itemLabel ?? '',
      amount,
      date,
      number: String(facts.number ?? ''),
    }).map(([key, value]) => [key, plainText(value).replace(/\n/g, ' ')]),
  )
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!(key in values)) throw new Error('EMAIL_PLACEHOLDER_UNKNOWN')
      return values[key]
    })
  const body =
    facts.itemLabel && copy.bodyItem
      ? copy.bodyItem
      : facts.number && copy.bodyNumber
        ? copy.bodyNumber
        : copy.body
  const subject =
    facts.number && copy.subjectNumber ? copy.subjectNumber : copy.subject
  const paragraphs = [fill(body)]
  if (facts.amount !== undefined && copy.amount)
    paragraphs.push(fill(copy.amount))
  if (facts.date && copy.date) paragraphs.push(fill(copy.date))
  if (copy.note) paragraphs.push(fill(copy.note))
  const freeText = plainText(facts.freeText)
  if (freeText) paragraphs.push(freeText)
  paragraphs.push(fill(copy.footer))
  return {
    templateKey: kind,
    templateVersion:
      kind === 'statement_issued' && facts.selfBilling
        ? 'v3'
        : TEMPLATE_VERSION,
    locale,
    subject: plainText(fill(subject).slice(0, 200)),
    body: paragraphs.join('\n\n'),
  }
}
