import { describe, expect, it } from 'vitest'
import { labelHeading } from '@/lib/labels/label-heading'
import { labelSheetDisposition } from '@/lib/documents/label-sheet-name'
import { setItemLabelFieldsCommand } from '@/lib/engine/label-fields'
import { dictionary, locales } from '@/lib/i18n'
const id = '30300000-0000-4000-8000-000000000001'
describe('label content choices', () => {
  it.each([null, undefined, '', ' . ', '…', '-- / + !', '😀'])(
    'omits non-descriptions %j',
    (s) => expect(labelHeading(s)).toBe(''),
  )
  it.each(['Ångström', 'Østerå', '中古', '42', 'A & B', 'T-shirt'])(
    'retains meaningful text %s',
    (s) => expect(labelHeading(s)).toBe(s),
  )
  it('validates explicit selection, reset, bounds and duplicate fields', () => {
    const command = {
      action: 'setItemLabelFields',
      tenantId: id,
      requestId: id,
      expectedRevision: 0,
    }
    for (const fields of [null, [], ['size', 'brand']])
      expect(
        setItemLabelFieldsCommand.safeParse({ ...command, fields }).success,
      ).toBe(true)
    for (const fields of [
      ['brand', 'brand'],
      ['description'],
      ['category'],
      ['bad field'],
      ['a', 'b', 'c', 'd', 'e'],
    ])
      expect(
        setItemLabelFieldsCommand.safeParse({ ...command, fields }).success,
      ).toBe(false)
  })
  it.each(locales)('provides translated field controls in %s', (locale) => {
    for (const text of Object.values(dictionary(locale).labelFields))
      expect(text.length).toBeGreaterThan(2)
  })
})
describe('private label download filenames', () => {
  const now = new Date('2026-10-26T23:30:00Z')
  it('uses the seller and Stockholm date with an encoded Unicode filename', () => {
    const header = labelSheetDisposition('Søren Åberg', true, now)
    expect(header).toContain('attachment;')
    expect(header).toContain('2026-10-27.pdf')
    expect(header).toContain(
      "filename*=UTF-8''S%C3%B8ren%20%C3%85berg%202026-10-27.pdf",
    )
  })
  it('uses a neutral name for mixed sheets and strips control/path characters', () => {
    expect(labelSheetDisposition(null, false, now)).toContain(
      'inline; filename="komisio-labels 2026-10-27.pdf"',
    )
    const header = labelSheetDisposition('A\r\n"/\\B\u202e', true, now)
    expect(header).not.toMatch(/[\r\n\\\u202e]/)
    expect(header).toContain('A B 2026-10-27.pdf')
    expect(() =>
      labelSheetDisposition('a'.repeat(99) + '😀', true, now),
    ).not.toThrow()
  })
})
