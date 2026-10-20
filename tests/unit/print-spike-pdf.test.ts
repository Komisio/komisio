import { describe, expect, it } from 'vitest'
import { renderSingleLabelPages } from '../../scripts/print-spike/label-pdf'

const input = {
  storeName: 'Synthetic store',
  items: [
    {
      id: '30300000-0000-4000-8000-000000000001',
      reference: 'I-30300000',
      title: 'Wool jacket ÅÄÖ',
      priceOre: '12345',
      currency: 'SEK',
    },
  ],
  copies: 2,
}
describe('exact-page-size label prototype', () => {
  it.each([
    [57, 32],
    [76, 51],
    [62, 32],
  ])(
    'uses a %s × %s mm MediaBox for every label',
    async (widthMm, heightMm) => {
      const pdf = Buffer.from(
        await renderSingleLabelPages({
          ...input,
          widthMm,
          heightMm,
        }),
      ).toString('latin1')
      expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2)
      const boxes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)]
      expect(boxes).toHaveLength(2)
      for (const box of boxes) {
        expect((Number(box[1]) * 25.4) / 72).toBeCloseTo(widthMm, 4)
        expect((Number(box[2]) * 25.4) / 72).toBeCloseTo(heightMm, 4)
      }
      expect(pdf).toContain('/FontFile2')
    },
  )
  it('refuses unreadable scaling, invalid geometry and unbounded copies', async () => {
    for (const [widthMm, heightMm, copies] of [
      [20, 15, 1],
      [Infinity, 32, 1],
      [57, 32, 11],
    ]) {
      await expect(
        renderSingleLabelPages({
          ...input,
          widthMm,
          heightMm,
          copies,
        }),
      ).rejects.toThrow()
    }
  })
})
