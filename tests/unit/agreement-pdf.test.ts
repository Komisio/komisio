import { describe, it, expect } from 'vitest'
import {
  renderAgreementPdf,
  agreementPdfResponse,
} from '../../lib/documents/agreement-pdf'
import { agreementPdfUrl } from '../../lib/documents/agreement-pdf-url'
import { locales } from '../../lib/i18n'

const agreement = {
  id: '30300000-0000-4000-8000-000000000001',
  title: 'Synthetic terms',
  body: 'Åsa Öberg · Æ Ø Å · äö · ß · ñ · è · €',
  language: 'sv' as const,
  version: 3,
}
describe('private printable agreement copies', () => {
  it('renders embedded fonts and multiple pages for long literal terms', async () => {
    const bytes = await renderAgreementPdf({
      agreement: { ...agreement, body: (agreement.body + '\n\n').repeat(120) },
      storeName: 'TEST store',
      sellerName: 'Åsa TEST',
    })
    const pdf = Buffer.from(bytes).toString('latin1')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf).toContain('/FontFile2')
    expect(pdf.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(2)
    expect(pdf).toContain('%%EOF')
  })
  it.each(locales)(
    'renders labels in %s and keeps downloads private',
    async (language) => {
      const bytes = await renderAgreementPdf({
        agreement: { ...agreement, language },
        storeName: 'Synthetic store',
      })
      expect(
        Buffer.from(bytes)
          .toString('latin1')
          .match(/\/Type \/Page\b/g),
      ).toHaveLength(1)
      const response = agreementPdfResponse(bytes, 3, language)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="agreement-v3-${language}.pdf"`,
      )
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(5000)
    },
  )
  it('pins the seller, version and selected text without names in URLs', () => {
    const url = new URL(
      agreementPdfUrl({
        tenantId: 'tenant',
        sellerId: 'seller',
        agreementId: 'version',
        textId: 'translation',
        portal: true,
      }),
      'https://example.test',
    )
    expect(url.pathname).toBe('/api/seller/agreement/pdf')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: 'tenant',
      seller: 'seller',
      version: 'version',
      text: 'translation',
    })
  })
})
