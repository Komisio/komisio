import { z } from 'zod'

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
export const TEMPLATE_VERSION = 'v1'

export const messageFacts = z.strictObject({
  storeName: z.string().trim().min(1).max(120),
  sellerName: z.string().trim().min(1).max(120),
  amount: z
    .string()
    .regex(/^-?\d+\.\d{2}$/)
    .optional(),
  number: z.number().int().positive().optional(),
  date: z.string().max(40).optional(),
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

const sv = {
  item_accepted: {
    subject: (f: MessageFacts) => `${f.storeName}: din vara är mottagen`,
    body: (f: MessageFacts) =>
      `Hej ${f.sellerName},\n\n${f.storeName} har tagit emot din vara${f.itemLabel ? ` (${f.itemLabel})` : ''} till försäljning${f.amount ? ` med priset ${f.amount} SEK` : ''}.`,
  },
  item_sold: {
    subject: (f: MessageFacts) => `${f.storeName}: din vara är såld`,
    body: (f: MessageFacts) =>
      `Hej ${f.sellerName},\n\nDin vara${f.itemLabel ? ` (${f.itemLabel})` : ''} har sålts hos ${f.storeName}${f.date ? ` ${f.date}` : ''}${f.amount ? `. Ditt tillgodohavande från försäljningen är ${f.amount} SEK` : ''}.`,
  },
  payout_approved: {
    subject: (f: MessageFacts) => `${f.storeName}: utbetalning godkänd`,
    body: (f: MessageFacts) =>
      `Hej ${f.sellerName},\n\n${f.storeName} har godkänt en utbetalning${f.amount ? ` på ${f.amount} SEK` : ''}. Pengarna betalas ut manuellt av butiken.`,
  },
  payout_paid: {
    subject: (f: MessageFacts) => `${f.storeName}: utbetalning gjord`,
    body: (f: MessageFacts) =>
      `Hej ${f.sellerName},\n\n${f.storeName} har betalat ut${f.amount ? ` ${f.amount} SEK` : ''}${f.date ? ` ${f.date}` : ''}.`,
  },
  statement_issued: {
    subject: (f: MessageFacts) =>
      `${f.storeName}: avräkning${f.number ? ` ${f.number}` : ''}`,
    body: (f: MessageFacts) =>
      `Hej ${f.sellerName},\n\n${f.storeName} har utfärdat avräkning${f.number ? ` nummer ${f.number}` : ''}${f.amount ? `. Utgående saldo: ${f.amount} SEK` : ''}. Be butiken om en utskrift om du vill se raderna.`,
  },
  message: {
    subject: (f: MessageFacts) => `Meddelande från ${f.storeName}`,
    body: (f: MessageFacts) => `Hej ${f.sellerName},`,
  },
}
const en = {
  item_accepted: {
    subject: (f: MessageFacts) => `${f.storeName}: your item is received`,
    body: (f: MessageFacts) =>
      `Hello ${f.sellerName},\n\n${f.storeName} has accepted your item${f.itemLabel ? ` (${f.itemLabel})` : ''} for sale${f.amount ? ` at ${f.amount} SEK` : ''}.`,
  },
  item_sold: {
    subject: (f: MessageFacts) => `${f.storeName}: your item is sold`,
    body: (f: MessageFacts) =>
      `Hello ${f.sellerName},\n\nYour item${f.itemLabel ? ` (${f.itemLabel})` : ''} sold at ${f.storeName}${f.date ? ` on ${f.date}` : ''}${f.amount ? `. Your credit from the sale is ${f.amount} SEK` : ''}.`,
  },
  payout_approved: {
    subject: (f: MessageFacts) => `${f.storeName}: payout approved`,
    body: (f: MessageFacts) =>
      `Hello ${f.sellerName},\n\n${f.storeName} has approved a payout${f.amount ? ` of ${f.amount} SEK` : ''}. The store pays it out manually.`,
  },
  payout_paid: {
    subject: (f: MessageFacts) => `${f.storeName}: payout made`,
    body: (f: MessageFacts) =>
      `Hello ${f.sellerName},\n\n${f.storeName} has paid out${f.amount ? ` ${f.amount} SEK` : ''}${f.date ? ` on ${f.date}` : ''}.`,
  },
  statement_issued: {
    subject: (f: MessageFacts) =>
      `${f.storeName}: settlement statement${f.number ? ` ${f.number}` : ''}`,
    body: (f: MessageFacts) =>
      `Hello ${f.sellerName},\n\n${f.storeName} has issued settlement statement${f.number ? ` number ${f.number}` : ''}${f.amount ? `. Closing balance: ${f.amount} SEK` : ''}. Ask the store for a printout to see the lines.`,
  },
  message: {
    subject: (f: MessageFacts) => `Message from ${f.storeName}`,
    body: (f: MessageFacts) => `Hello ${f.sellerName},`,
  },
}
const footer = {
  sv: (store: string) =>
    `\n\nDetta meddelande skickades av ${store} via Komisio. Svara till butiken, inte till denna adress.`,
  en: (store: string) =>
    `\n\nThis message was sent by ${store} through Komisio. Reply to the store, not to this address.`,
}

/** Renders one message. Every dynamic value is plain text inside fixed wording. */
export function renderSellerMessage(
  kindInput: unknown,
  locale: 'sv' | 'en',
  factsInput: unknown,
) {
  const kind = communicationKind.parse(kindInput)
  const raw = messageFacts.parse(factsInput)
  const f: MessageFacts = {
    ...raw,
    storeName: plainText(raw.storeName).replace(/\n/g, ' '),
    sellerName: plainText(raw.sellerName).replace(/\n/g, ' '),
    itemLabel: raw.itemLabel
      ? plainText(raw.itemLabel).replace(/\n/g, ' ')
      : undefined,
    freeText: plainText(raw.freeText),
  }
  const t = (locale === 'sv' ? sv : en)[kind]
  const body =
    t.body(f) +
    (f.freeText ? `\n\n${f.freeText}` : '') +
    footer[locale](f.storeName)
  return {
    templateKey: kind,
    templateVersion: TEMPLATE_VERSION,
    subject: t.subject(f).slice(0, 200),
    body,
  }
}
