import { describe, it, expect } from 'vitest'
import { renderLabelSheetPdf } from '../../lib/documents/label-sheet-pdf'
import { labelSheetQuery } from '../../lib/engine/label-sheets'
const item = {
  id: '30300000-0000-4000-8000-000000000001',
  reference: 'I-30300000',
  title: 'Synthetic wool jacket ÅÄÖ',
  priceOre: '12345',
  currency: 'SEK',
}
describe('A4 label sheets', () => {
  it.each([
    ['50x50', 15],
    ['57x32', 24],
  ] as const)(
    'paginates %s without lost or extra labels',
    async (size, perPage) => {
      const bytes = await renderLabelSheetPdf({
        storeName: 'Synthetic store',
        items: Array.from({ length: perPage + 1 }, () => item),
        size,
        copies: 1,
      })
      const pdf = Buffer.from(bytes).toString('latin1')
      expect(pdf.startsWith('%PDF-')).toBe(true)
      expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2)
      expect(pdf).toContain('/FontFile2')
    },
  )
  it('bounds output before rendering', async () => {
    await expect(
      renderLabelSheetPdf({
        storeName: 'Test',
        items: Array.from({ length: 41 }, () => item),
        copies: 10,
        size: '50x50',
      }),
    ).rejects.toThrow('Too many labels')
  })
  it('requires a single bounded selection', () => {
    const tenant = item.id
    expect(labelSheetQuery.safeParse({ tenant, items: item.id }).success).toBe(
      true,
    )
    expect(
      labelSheetQuery.safeParse({
        tenant,
        items: '30300000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(true)
    expect(
      labelSheetQuery.safeParse({ tenant, bag: item.id, items: item.id })
        .success,
    ).toBe(false)
    expect(
      labelSheetQuery.safeParse({ tenant, items: 'garment-1' }).success,
    ).toBe(false)
    expect(
      labelSheetQuery.safeParse({ tenant, items: item.id, copies: 0 }).success,
    ).toBe(false)
    expect(
      labelSheetQuery.safeParse({
        tenant,
        items: Array(201).fill(item.id).join(','),
      }).success,
    ).toBe(false)
  })
})
