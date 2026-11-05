import { describe, expect, it } from 'vitest'
import { dictionary, locales } from '../../lib/i18n'
import { registrationTitleTemplate } from '../../lib/engine/registration'
import {
  addTitleField,
  moveTitleField,
  parseTitleTemplate,
  previewTitleTemplate,
  removeTitleField,
  serializeTitleTemplate,
  titleFields,
} from '../../lib/intake/title-template'

describe('localized automatic-name editing', () => {
  it.each([
    '{type} {brand} {size}',
    'Vintage: {brand} / {type} ({size})',
    '  {brand}  {brand} – {type}  ',
    'A literal title without fields',
    '{type}{size}',
  ])('round-trips an existing template exactly: %s', (value) => {
    expect(serializeTitleTemplate(parseTitleTemplate(value))).toBe(value)
  })

  it('reorders fields without losing existing literal text or separators', () => {
    const original = 'Vintage: {brand} / {type} ({size})'
    expect(moveTitleField(original, 1, -1)).toBe(
      'Vintage: {type} / {brand} ({size})',
    )
    expect(moveTitleField(original, 0, -1)).toBe(original)
    expect(moveTitleField(original, 2, 1)).toBe(original)
    expect(moveTitleField(moveTitleField(original, 1, -1), 0, 1)).toBe(original)
  })

  it('removes only a selected field and redundant whitespace', () => {
    const original = '{type} {brand} {size}'
    expect(removeTitleField(original, 0)).toBe('{brand} {size}')
    expect(removeTitleField(original, 1)).toBe('{type} {size}')
    expect(removeTitleField(original, 2)).toBe('{type} {brand}')
    expect(removeTitleField('{type}', 0)).toBe('')
    expect(removeTitleField('Vintage {brand} / {type}', 0)).toBe(
      'Vintage  / {type}',
    )
    expect(removeTitleField(original, 10)).toBe(original)
  })

  it('adds fields without duplicating them or rewriting literal text', () => {
    expect(addTitleField('', 'brand')).toBe('{brand}')
    expect(addTitleField('{type}', 'brand')).toBe('{type} {brand}')
    expect(addTitleField('Vintage: ', 'brand')).toBe('Vintage: {brand}')
    expect(addTitleField('{brand}  ', 'brand')).toBe('{brand}  ')
    expect(
      registrationTitleTemplate.safeParse(
        addTitleField('x'.repeat(235), 'material'),
      ).success,
    ).toBe(false)
  })

  it('previews a single substitution pass, skips missing values and falls back to a reference', () => {
    expect(
      previewTitleTemplate('{type} {brand} {size}', {
        type: 'Dress',
        size: 'M',
      }),
    ).toBe('Dress M')
    expect(
      previewTitleTemplate('{brand} {type}', {
        brand: '{type} $&',
        type: 'Dress',
      }),
    ).toBe('{type} $& Dress')
    expect(previewTitleTemplate('{type} {brand}', {})).toBe('I-1234ABCD')
  })

  it.each(locales)(
    'has labels, action copy and a complete example in %s',
    (locale) => {
      const { registration: d } = dictionary(locale)
      const t = d.titleBuilder
      expect(t.earlier).toContain('{field}')
      expect(t.later).toContain('{field}')
      expect(t.remove).toContain('{field}')
      expect(t.after).toContain('{field}')
      for (const field of titleFields) {
        expect(t.examples[field].length).toBeGreaterThan(0)
        expect(
          d.visibility.fields[field === 'type' ? 'itemType' : field].length,
        ).toBeGreaterThan(0)
      }
      expect(previewTitleTemplate('{type} {brand} {size}', t.examples)).toBe(
        `${t.examples.type} Nord M`,
      )
    },
  )
})
