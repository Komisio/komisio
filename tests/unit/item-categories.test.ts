import { describe, expect, it } from 'vitest'
import {
  categoryName,
  createCategoryInput,
} from '../../lib/engine/item-categories'
describe('category names', () => {
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
