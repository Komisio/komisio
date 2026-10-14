import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('ownership filters count and page all goods and carry through stock reports', async ({
  page,
}) => {
  const email = `inventory-ownership-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Synthetic consignment jacket')
    const ownItems: string[] = []
    for (let index = 0; index < 26; index++) {
      const purchase = randomUUID(),
        item = randomUUID()
      await f.db.query('select register_purchase($1,$2,$3,10000,$4,false)', [
        f.tenant,
        purchase,
        `Synthetic own lamp ${index}`,
        `Synthetic receipt ${index}`,
      ])
      await f.db.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
        f.tenant,
        item,
        purchase,
      ])
      ownItems.push(item)
    }
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake/items?ownership=store')
    const rows = page.locator('.inventory-row')
    await expect(rows).toHaveCount(25)
    await expect(
      page.getByLabel(d.items.ownership, { exact: true }),
    ).toHaveValue('store')
    await expect(
      rows.getByRole('button', {
        name: d.items.ownershipKinds.store,
        exact: true,
      }),
    ).toHaveCount(25)
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('ownership'))
      .toBe('store')
    await page.getByLabel(d.items.search, { exact: true }).fill('lamp 25')
    await page
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .first()
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Synthetic own lamp 25')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('page'))
      .toBeNull()
    await page
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(rows).toHaveCount(25)
    await page.locator('.inventory-advanced summary').click()
    await page
      .getByLabel(d.items.ownership, { exact: true })
      .selectOption('consignment')
    await page
      .locator('.inventory-basic')
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(
      rows.getByRole('button', {
        name: d.items.ownershipKinds.consignment,
        exact: true,
      }),
    ).toBeVisible()
    await rows.locator('.inventory-open-item').click()
    await expect(
      page
        .locator('.item-workspace-meta')
        .getByText(d.items.ownershipKinds.consignment, { exact: true }),
    ).toBeVisible()

    await page.goto('/intake/stock?ownership=store')
    await page.locator('.stock-ownership-filter').getByRole('button').click()
    await expect(
      page.getByRole('tab', { name: d.stock.tabs.overview, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('region', { name: d.stock.current }),
    ).toContainText('6500.00 SEK')
    const salesTab = page.getByRole('tab', {
      name: d.stock.tabs.sales,
      exact: true,
    })
    await expect(salesTab).toBeEnabled()
    await page
      .getByRole('tab', { name: d.stock.tabs.overview, exact: true })
      .focus()
    await page.keyboard.press('End')
    await expect(salesTab).toBeFocused()
    await expect(salesTab).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel(d.economy.from, { exact: true }).fill('2020-01-01')
    await page.getByLabel(d.economy.to, { exact: true }).fill('2020-01-31')
    await page
      .locator('.stock-period')
      .getByRole('button', { name: d.economy.show, exact: true })
      .click()
    await expect(salesTab).toHaveAttribute('aria-selected', 'true')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('ownership'))
      .toBe('store')
    await page
      .getByRole('tab', { name: d.stock.tabs.overview, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.stock.current }),
    ).toContainText('6500.00 SEK')
    await page
      .getByRole('combobox', { name: d.items.ownership })
      .selectOption('consignment')
    await page.locator('.stock-ownership-filter').getByRole('button').click()
    await expect(
      page.getByRole('tab', { name: d.stock.tabs.overview, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('region', { name: d.stock.current }),
    ).toContainText('200.00 SEK')
    for (const [tab, ownership] of [
      [d.stock.tabs.categories, 'store'],
      [d.stock.tabs.sales, 'consignment'],
    ]) {
      const selected = page.getByRole('tab', { name: tab, exact: true })
      await selected.click()
      await page
        .getByRole('combobox', { name: d.items.ownership })
        .selectOption(ownership)
      await page.locator('.stock-ownership-filter').getByRole('button').click()
      await expect(page).toHaveURL(new RegExp('ownership=' + ownership))
      await expect(selected).toHaveAttribute('aria-selected', 'true')
      await expect
        .poll(() => new URL(page.url()).searchParams.get('from'))
        .toBe('2020-01-01')
    }
    await page
      .getByRole('tab', { name: d.stock.tabs.overview, exact: true })
      .click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/gui-stock-ownership-mobile.png',
      fullPage: true,
    })
    expect(ownItems).toHaveLength(26)
  } finally {
    await f.close()
  }
})

test('new purchase stays in its tab and explicitly continues to the saved receipt', async ({
  page,
}) => {
  const email = `purchase-workspace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/purchases#purchases-new')
    const newTab = page.getByRole('tab', {
      name: d.purchases.newPurchase,
      exact: true,
    })
    await expect(newTab).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel(d.purchases.price, { exact: true }).fill('125')
    await page
      .getByLabel(d.purchases.evidence, { exact: true })
      .fill('Synthetic GUI receipt')
    await page
      .getByLabel(d.purchases.note, { exact: true })
      .fill('Synthetic own vase')
    await page
      .getByRole('tab', { name: d.purchases.history, exact: true })
      .click()
    await page.goBack()
    await expect(newTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByLabel(d.purchases.price, { exact: true }),
    ).toHaveValue('125')
    await page
      .getByRole('button', { name: d.purchases.register, exact: true })
      .click()
    await expect(
      page
        .getByRole('tabpanel', { name: d.purchases.newPurchase })
        .getByRole('status'),
    ).toContainText(d.purchases.registered)
    await expect(newTab).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('link', { name: d.purchases.continueToItem, exact: true })
      .click()
    const history = page.getByRole('tabpanel', {
      name: d.purchases.history,
      exact: true,
    })
    await expect(history).toBeVisible()
    const salePrice = history.getByLabel(d.items.purchaseSalePrice, {
      exact: true,
    })
    await expect(
      history.getByText(d.items.priceHint, { exact: true }),
    ).toHaveCount(0)
    await salePrice.fill('250')
    await history
      .getByRole('button', { name: d.items.createPurchasedItem, exact: true })
      .click()
    await expect(
      history.getByRole('link', { name: new RegExp(d.items.open) }),
    ).toBeVisible()
    const items = (
      await f.db.query(
        'select ownership,seller_id from items where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(items).toEqual([{ ownership: 'store', seller_id: null }])
  } finally {
    await f.close()
  }
})
