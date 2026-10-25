import { it, expect } from 'vitest'
import { selfBilling, statementTitle } from '../../lib/engine/self-billing'
import { selfBillingContent } from '../../lib/documents/self-billing-content'
import {
  renderSelfBillingPdf,
  selfBillingPdfResponse,
} from '../../lib/documents/self-billing-pdf'
import { renderSellerMessage } from '../../lib/communications/templates'
import { dictionary, locales } from '../../lib/i18n'

const id = '30300000-0000-4000-8000-000000000001'
const invoice = selfBilling.parse({
  version: 1,
  currency: 'DKK',
  supplier: {
    name: 'Synthetic seller',
    email: 'test@example.test',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: '',
    business: {
      companyName: 'Synthetic Æ Ø Å company',
      vatRegistered: true,
      vatNumber: 'XX123',
    },
  },
  buyer: { name: 'Synthetic store', address: {}, contact: {} },
  lines: [
    {
      saleLineId: id,
      referenceId: id,
      kind: 'credit_sale',
      description: 'Synthetic jacket',
      occurredAt: '2026-10-24T10:00:00Z',
      grossOre: 10000,
      netOre: 8000,
      vatOre: 2000,
      rateBp: 2500,
      mode: 'consignment_business',
      vatNumber: 'XX123',
    },
  ],
})
const document = {
  id,
  number: 12,
  kind: 'statement',
  period_from: '2026-10-24T00:00:00Z',
  period_to: '2026-10-25T00:00:00Z',
  issued_at: '2026-10-25T10:00:00Z',
  opening_ore: 0,
  closing_ore: 10000,
  self_billing: invoice,
}
it('displays frozen supplier amounts separately from balances and reverses by facts', () => {
  const output = selfBillingContent(invoice, 'en')
  expect(output.lines[0]).toMatchObject({
    net: '80.00 DKK',
    vat: '20.00 DKK',
    gross: '100.00 DKK',
  })
  const reversal = {
    ...invoice,
    lines: [
      ...invoice.lines,
      {
        ...invoice.lines[0],
        grossOre: -10000,
        netOre: -8000,
        vatOre: -2000,
        kind: 'credit_reversal' as const,
      },
    ],
  }
  expect(selfBillingContent(reversal, 'en').totals[0].gross).toBe('0.00 DKK')
  expect(
    statementTitle(
      { ...document, kind: 'credit_note' },
      dictionary('en').statements,
    ),
  ).toBe('Self-billing credit note')
})
it('does not label non-registered supplier VAT as a zero-rated taxable supply', () => {
  const output = selfBillingContent(
    {
      ...invoice,
      lines: [{ ...invoice.lines[0], rateBp: null, vatOre: 0, netOre: 10000 }],
    },
    'en',
  )
  expect(output.lines[0].vat).toBe('—')
  expect(output.lines[0].rate).toBe(dictionary('en').statements.noSeparateVat)
})
it.each(locales)(
  'renders self-billing PDF and email wording in %s',
  async (locale) => {
    const bytes = await renderSelfBillingPdf(document, locale)
    const pdf = Buffer.from(bytes).toString('latin1')
    expect(pdf).toContain('%PDF-')
    expect(pdf).toContain('/FontFile2')
    expect(pdf).toContain('%%EOF')
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1)
    const response = selfBillingPdfResponse(bytes, 12)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const message = renderSellerMessage('statement_issued', locale, {
      storeName: 'Test',
      sellerName: 'Test',
      selfBilling: true,
      number: 12,
    })
    expect(message.locale).toBe(locale)
    expect(message.subject).toContain(dictionary(locale).statements.selfBilling)
  },
)
it('paginates long invoices with embedded Unicode fonts', async () => {
  const bytes = await renderSelfBillingPdf(
    {
      ...document,
      self_billing: {
        ...invoice,
        lines: Array.from({ length: 40 }, () => ({
          ...invoice.lines[0],
          description: 'Åsa ÆØÅ äö ß ñ è € '.repeat(12),
        })),
      },
    },
    'dk',
  )
  expect(
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/Type \/Page\b/g)!.length,
  ).toBeGreaterThan(5)
})

it.each(locales)('identifies self-billing corrections in %s mail', (locale) => {
  const m = renderSellerMessage('statement_issued', locale, {
    storeName: 'Test',
    sellerName: 'Test',
    selfBilling: true,
    statementKind: 'credit_note',
    number: 13,
  })
  expect(m.locale).toBe(locale)
  expect(m.templateVersion).toBe('v3')
  expect(m.subject).toContain(dictionary(locale).statements.selfBillingCredit)
})
