import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller and category ID choices stay tenant-scoped and compose across pages', async ({
  page,
}) => {
  const email = `choice-filters-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release!: () => void
  const scripts = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const categoryId = randomUUID()
    await f.db.query("select register_seller($1,$2,$3,$4,'')", [
      f.tenant,
      randomUUID(),
      'Synthetic P2 seller',
      `duplicate-${randomUUID()}@example.test`,
    ])
    await f.db.query('select create_item_category($1,$2,$3,$4)', [
      f.tenant,
      categoryId,
      'Jackets',
      '{"en":"Jackets","sv":"Jackor"}',
    ])
    for (let n = 0; n < 27; n++) await f.item(`Coat ${n}`)
    const foreign = (
      await f.db.query('select create_tenant($1,$2,$3) id', [
        'Other test store',
        `other-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    await f.db.query("select register_seller($1,$2,$3,$4,'')", [
      foreign,
      randomUUID(),
      'Other store seller',
      `other-${randomUUID()}@example.test`,
    ])
    await f.db.query('select create_item_category($1,$2,$3,$4)', [
      foreign,
      randomUUID(),
      'Other category',
      '{"en":"Other category"}',
    ])
    await f.db.query('select set_active_tenant($1)', [f.tenant])
    await f.commit()
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.goto('/intake/items?stage=active&q=Coat&ownership=consignment', {
      waitUntil: 'commit',
    })
    await expect(page.locator('.inventory-advanced')).toHaveAttribute(
      'open',
      '',
    )
    const seller = page.getByRole('combobox', {
      name: d.quickIntake.seller,
      exact: true,
    })
    const category = page.getByLabel(d.quickIntake.category, { exact: true })
    await expect(seller).toBeDisabled()
    await expect(category).toBeDisabled()
    release()
    await expect(seller).toBeEnabled()
    await expect(category).toBeEnabled()
    await expect(seller.locator('option')).toHaveCount(3)
    await expect(seller).not.toContainText('Other store seller')
    await seller.selectOption(f.seller)
    await category.selectOption(categoryId)
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('categoryId'))
      .toBe(categoryId)
    expect(new URL(page.url()).searchParams.get('seller')).toBe(f.seller)
    await expect(
      page.locator(`#items-category option[value="${categoryId}"]`),
    ).toHaveCount(1)
    await expect(
      category.locator('option').filter({ hasText: 'Other category' }),
    ).toHaveCount(0)
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(2)
    await expect(seller).toHaveValue(f.seller)
    await expect(category).toHaveValue(categoryId)
    const removeSeller = d.items.directory.removeFilter.replace(
      '{filter}',
      `${d.quickIntake.seller}: Synthetic P2 seller`,
    )
    await page.getByRole('link', { name: removeSeller, exact: true }).click()
    await expect(seller).toHaveValue('')
    await expect(category).toHaveValue(categoryId)
    expect(new URL(page.url()).searchParams.get('stage')).toBe('active')
    await category.selectOption('none')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('categoryId'))
      .toBe('none')
    await expect(page.locator('.inventory-row')).toHaveCount(0)
    await page.reload()
    await expect(category).toHaveValue('none')
  } finally {
    release()
    await f.close()
  }
})
