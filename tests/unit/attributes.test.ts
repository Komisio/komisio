import { describe, expect, it } from 'vitest'
import {
  attributeVocabulary,
  labelOf,
  questionsFor,
  type AttributeVocabulary,
} from '../../lib/engine/attributes'

const definition = (
  slug: string,
  extra: Partial<AttributeVocabulary['definitions'][number]> = {},
) => ({
  slug,
  version: 1,
  data_type: 'text' as const,
  unit: '',
  choices: [],
  labels: { sv: slug, en: slug },
  help: {},
  active: true,
  own: false,
  ...extra,
})

const vocabulary: AttributeVocabulary = attributeVocabulary.parse({
  definitions: [
    definition('description'),
    definition('size'),
    definition('socket', {
      data_type: 'choice',
      choices: [{ id: 'e27', labels: { sv: 'E27', en: 'E27' }, sort: 1 }],
      labels: { sv: 'Sockel', en: 'Socket' },
    }),
    definition('height_cm', {
      data_type: 'number',
      unit: 'cm',
      labels: { en: 'Height' },
    }),
    definition('retired', { active: false }),
  ],
  types: [
    {
      slug: 'sweater',
      labels: { sv: 'Tröja', en: 'Sweater' },
      suggested_category: 'Tröjor',
      active: true,
      own: false,
      attributes: [
        { slug: 'description', expected: true, sort: 1 },
        { slug: 'size', expected: true, sort: 2 },
      ],
    },
    {
      slug: 'lamp',
      labels: { en: 'Lamp' },
      suggested_category: 'Belysning',
      active: true,
      own: false,
      attributes: [
        { slug: 'description', expected: true, sort: 1 },
        { slug: 'socket', expected: true, sort: 2 },
        { slug: 'height_cm', expected: false, sort: 3 },
        { slug: 'retired', expected: false, sort: 4 },
        { slug: 'nothing_defines_this', expected: false, sort: 5 },
      ],
    },
  ],
})

describe('attribute vocabulary', () => {
  it('asks a lamp about its socket and a sweater about its size', () => {
    expect(
      questionsFor(vocabulary, 'lamp').map((q) => q.definition.slug),
    ).toEqual(['description', 'socket', 'height_cm'])
    expect(
      questionsFor(vocabulary, 'sweater').map((q) => q.definition.slug),
    ).toEqual(['description', 'size'])
  })
  it('leaves out what is retired or undefined rather than showing a dead input', () => {
    const slugs = questionsFor(vocabulary, 'lamp').map((q) => q.definition.slug)
    expect(slugs).not.toContain('retired')
    expect(slugs).not.toContain('nothing_defines_this')
  })
  it('asks only for a description before a type is chosen', () => {
    expect(
      questionsFor(vocabulary, null).map((q) => q.definition.slug),
    ).toEqual(['description'])
    expect(questionsFor(vocabulary, 'no_such_type')).toHaveLength(1)
  })
  it('keeps the profile order and marks what is expected', () => {
    const lamp = questionsFor(vocabulary, 'lamp')
    expect(lamp.map((q) => q.expected)).toEqual([true, true, false])
  })
  it('carries the unit and the stable value ids a form needs', () => {
    const lamp = questionsFor(vocabulary, 'lamp')
    const height = lamp.find((q) => q.definition.slug === 'height_cm')
    expect(height?.definition.unit).toBe('cm')
    const socket = lamp.find((q) => q.definition.slug === 'socket')
    expect(socket?.definition.choices[0].id).toBe('e27')
  })
  it('reads a label in the locale, then English, then the slug', () => {
    const socket = vocabulary.definitions.find((d) => d.slug === 'socket')!
    expect(labelOf(socket, 'sv')).toBe('Sockel')
    expect(labelOf(socket, 'de')).toBe('Socket')
    const height = vocabulary.definitions.find((d) => d.slug === 'height_cm')!
    expect(labelOf(height, 'sv')).toBe('Height')
    expect(labelOf({ slug: 'x', labels: {} }, 'sv')).toBe('x')
  })
})
