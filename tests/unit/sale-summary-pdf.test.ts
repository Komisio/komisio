import { expect, it } from 'vitest'
import {
  renderSaleSummaryPdf,
  saleSummaryPdfResponse,
} from '../../lib/documents/sale-summary-pdf'
import type { SaleSummary } from '../../lib/engine/sale-summary'
import { locales } from '../../lib/i18n'
const summary: SaleSummary = {
  id: '30300000-0000-4000-8000-000000000001',
  storeName: 'Åsas testbutik',
  address: 'Testgatan 1',
  locale: 'sv',
  occurredAt: '2026-10-26T10:00:00Z',
  generatedAt: '2026-10-26T11:00:00Z',
  reference: 'TEST-1',
  currency: 'SEK',
  status: 'completed',
  totalOre: '20000',
  lines: [
    {
      reference: 'I-12345678',
      title: 'Kavaj ÅÄÖ é €',
      attributes: ['Storlek: M'],
      priceOre: '20000',
      returned: null,
    },
  ],
}
it.each(locales)(
  'renders embedded fonts and private downloads in %s',
  async (locale) => {
    const bytes = await renderSaleSummaryPdf({ ...summary, locale })
    const pdf = Buffer.from(bytes).toString('latin1')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf).toContain('/FontFile2')
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1)
    const response = saleSummaryPdfResponse(bytes, summary.id)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toContain(
      `sale-summary-${summary.id}.pdf`,
    )
  },
)
it('paginates fifty long rows including returns', async () => {
  const bytes = await renderSaleSummaryPdf({
    ...summary,
    status: 'reversed',
    totalOre: '1000000',
    lines: Array.from({ length: 50 }, (_, index) => ({
      ...summary.lines[0],
      title: `${index + 1}: ${'Lång beskrivning med ÅÄÖ. '.repeat(40)}`,
      attributes: ['Material: ull', 'Färg: blå'],
      returned: { occurredAt: summary.generatedAt, amountOre: '20000' },
    })),
  })
  const pdf = Buffer.from(bytes).toString('latin1')
  expect(pdf.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(5)
  expect(pdf).toContain('%%EOF')
})
