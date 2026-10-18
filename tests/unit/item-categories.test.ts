import { describe, expect, it } from 'vitest'
import {
  categoryName,
  createCategoryInput,
  categoryChoices,
} from '../../lib/engine/item-categories'
describe('category names', () => {
  it('keeps aliases for localized display and marks inactive entries for exclusion from new choices', () => {
    const categories = [
      {
        id: 'one',
        name: 'Books',
        labels: { sv: 'Samma' },
        active: true,
        version: 1,
      },
      {
        id: 'two',
        name: 'Media',
        labels: { sv: 'Samma' },
        active: true,
        version: 0,
      },
      {
        id: 'three',
        name: 'Retired',
        labels: { sv: 'Retired' },
        active: false,
        version: 2,
      },
    ]
    expect(categoryChoices(categories, 'sv')).toEqual([
      {
        id: 'one',
        name: 'Samma',
        label: 'Samma (Books)',
        active: true,
        aliases: ['Books', 'Samma'],
      },
      {
        id: 'two',
        name: 'Samma',
        label: 'Samma (Media)',
        active: true,
        aliases: ['Media', 'Samma'],
      },
      {
        id: 'three',
        name: 'Retired',
        label: 'Retired',
        active: false,
        aliases: ['Retired'],
      },
    ])
  })
  it('uses translated presentation without changing the stored category', () => {
    const category = {
      id: 'f0000000-0000-4000-8000-000000003280',
      name: 'Books',
      labels: { sv: 'Böcker', en: 'Books' },
    }
    expect(categoryName(category, 'sv')).toBe('Böcker')
    expect(categoryName(category, 'de')).toBe('Books')
    expect(category.name).toBe('Books')
    expect(categoryName({ ...category, labels: { sv: 'Böcker' } }, 'en')).toBe(
      'Books',
    )
  })
  it('requires a name and supported nonempty translations', () => {
    const input = {
      tenantId: 'f0000000-0000-4000-8000-000000003280',
      requestId: 'f0000000-0000-4000-8000-000000003281',
      name: 'Books',
      labels: { en: 'Books' },
    }
    expect(createCategoryInput.safeParse(input).success).toBe(true)
    expect(
      createCategoryInput.safeParse({ ...input, labels: {} }).success,
    ).toBe(false)
    expect(
      createCategoryInput.safeParse({ ...input, labels: { xx: 'Books' } })
        .success,
    ).toBe(false)
    expect(createCategoryInput.safeParse({ ...input, name: ' ' }).success).toBe(
      false,
    )
  })
})
