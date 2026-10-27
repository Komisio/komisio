import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('stock links and removable filter chips retain context across pages, status and advanced filters', async ({
  page,
}) => {
  const email = `filter-chips-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const categoryId = randomUUID()
    await f.db.query('select create_item_category($1,$2,$3,$4)', [
      f.tenant,
      categoryId,
      'Jackets',
      { en: 'Jackets' },
    ])
    for (let n = 0; n < 27; n++)
      await f.item(`Coat ${String(n).padStart(2, '0')}`)
    await f.commit()
    await page.goto('/intake/stock?ownership=consignment')
    await page
      .getByRole('link', {
        name: `${d.sellerPortal.itemFilters.active}: 27`,
        exact: true,
      })
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    expect(new URL(page.url()).searchParams.get('stage')).toBe('active')
    expect(new URL(page.url()).searchParams.get('ownership')).toBe(
      'consignment',
    )
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(2)
    expect(new URL(page.url()).searchParams.get('stage')).toBe('active')
    await page.goto(
      '/intake/items?stage=active&q=Coat&category=Jackets&ownership=consignment&sort=title&direction=asc&page=2',
    )
    await page.locator('.inventory-advanced summary').click()
    const chips = page.getByRole('navigation', {
      name: d.items.directory.activeFilters,
      exact: true,
    })
    await expect(chips).toBeVisible()
    const removeCategory = d.items.directory.removeFilter.replace(
      '{filter}',
      `${d.quickIntake.category}: Jackets`,
    )
    await chips.getByRole('link', { name: removeCategory, exact: true }).click()
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      stage: 'active',
      q: 'Coat',
      ownership: 'consignment',
      sort: 'title',
      direction: 'asc',
    })
    await expect(page.getByLabel(d.items.search, { exact: true })).toHaveValue(
      'Coat',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(chips).toBeVisible()
    expect(
      await chips.evaluate(
        (el) => el.getBoundingClientRect().right <= window.innerWidth,
      ),
    ).toBe(true)
    await expect(
      page.getByRole('navigation', { name: 'Snabbfilter', exact: true }),
    ).toHaveCount(0)
    await page
      .getByLabel(d.items.stage, { exact: true })
      .selectOption('markdown_due')
    await expect(page).toHaveURL(/stage=markdown_due/)
    expect(new URL(page.url()).searchParams.get('q')).toBe('Coat')
    if (
      (await page.locator('.inventory-advanced').getAttribute('open')) === null
    )
      await page.locator('.inventory-advanced summary').click()
    await page
      .getByLabel(d.items.directory.endsBefore, { exact: true })
      .fill('2000-01-01')
    await expect(page.locator('.inventory-row')).toHaveCount(0)
    await page
      .getByLabel(d.items.directory.endsBefore, { exact: true })
      .fill('2099-12-31')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('endsBefore'))
      .toBe('2099-12-31')
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    expect(new URL(page.url()).searchParams.get('stage')).toBe('markdown_due')
    expect(new URL(page.url()).searchParams.get('q')).toBe('Coat')
    await expect(chips).toContainText(d.items.directory.endsBefore)
    await page
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/items$/)
    await expect(chips).toHaveCount(0)
    await expect(page.getByLabel(d.items.search, { exact: true })).toHaveValue(
      '',
    )
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    await page.goto('/intake/stock?ownership=consignment#stock-categories')
    await page.getByRole('link', { name: 'Jackets', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('categoryId'))
      .toBe(categoryId)
    expect(new URL(page.url()).searchParams.get('ownership')).toBe(
      'consignment',
    )
    await expect(chips).toContainText('Jackets')
  } finally {
    await f.close()
  }
})
