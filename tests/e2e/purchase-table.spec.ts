import { expectDetailTarget } from '../helpers/detail-target'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('purchase table searches and sorts the complete list and creates an item in its row', async ({
  page,
}) => {
  const email = `purchase-table-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids: string[] = []
    for (let i = 0; i < 24; i++) {
      ids.push(randomUUID())
      await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
        f.tenant,
        ids[i],
        `Synthetic item ${String(i).padStart(2, '0')}`,
        (i + 1) * 100,
        `Receipt ${i}`,
      ])
    }
    const item = randomUUID()
    await f.db.query("select accept_item($1,$2,'purchase',$3,null,5500)", [
      f.tenant,
      item,
      ids[0],
    ])
    await f.commit()
    await page.goto('/intake/purchases')
    const rows = page.locator('.purchase-table tbody tr')
    await expect(rows).toHaveCount(20)
    await page
      .getByRole('columnheader', { name: `${d.purchases.price} (SEK)` })
      .getByRole('link')
      .click()
    await expect(rows.first().locator('td').nth(3)).toHaveText('1.00')
    await expect(rows.last().locator('td').nth(3)).toHaveText('20.00')
    await page
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .click()
    await expect(rows).toHaveCount(4)
    await expect(rows.first().locator('td').nth(3)).toHaveText('21.00')
    const search = page.getByRole('searchbox', { name: d.purchases.search })
    const filter = page.getByRole('combobox', { name: d.purchases.status })
    const apply = page.getByRole('button', {
      name: d.purchases.search,
      exact: true,
    })
    await search.fill('Synthetic item 23')
    await apply.click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Synthetic item 23')
    expect(new URL(page.url()).searchParams.get('page')).toBeNull()
    await search.fill('')
    await filter.selectOption('registered')
    await apply.click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(d.purchases.statusRegistered)
    await expectDetailTarget(
      rows.first().getByRole('link', { name: d.items.open, exact: true }),
      `/intake/items/${item}`,
    )
    await expect(rows.first().locator('.purchase-item-link')).toContainText(
      '55.00',
    )
    await search.fill('Receipt 23')
    await filter.selectOption('pending')
    await apply.click()
    await expect(rows).toHaveCount(1)
    const price = rows
      .first()
      .getByLabel(d.items.purchaseSalePrice, { exact: true })
    await price.fill('125,50')
    let warnings = 0
    const dismiss = async (dialog: import('@playwright/test').Dialog) => {
      warnings++
      await dialog.dismiss()
    }
    page.on('dialog', dismiss)
    await filter.selectOption('all')
    await apply.click()
    await expect.poll(() => warnings).toBe(1)
    await expect(price).toHaveValue('125,50')
    await expect(page).toHaveURL(/status=pending/)
    await page
      .getByRole('columnheader', { name: d.purchases.description, exact: true })
      .getByRole('link')
      .click()
    await expect.poll(() => warnings).toBe(2)
    await expect(price).toHaveValue('125,50')
    page.off('dialog', dismiss)
    await rows
      .first()
      .getByRole('button', { name: d.items.createPurchasedItem, exact: true })
      .click()
    await expect(rows).toHaveCount(0)
    await expect(
      page.getByText(d.purchases.noMatches, { exact: true }),
    ).toBeVisible()
    await filter.selectOption('registered')
    await apply.click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(d.purchases.statusRegistered)
    await expect(rows.first().locator('form')).toHaveCount(0)
    await expect(rows.first().locator('.purchase-item-link')).toContainText(
      '125.50',
    )
    const facts = await f.db.query(
      'select i.seller_id,i.ownership,p.price_ore::text from items i join item_prices p on p.item_id=i.id where i.tenant_id=$1 and i.origin_id=$2',
      [f.tenant, ids[23]],
    )
    expect(facts.rows).toEqual([
      { seller_id: null, ownership: 'store', price_ore: '12550' },
    ])
    await search.fill('')
    await filter.selectOption('all')
    await apply.click()
    await expect(rows).toHaveCount(20)
    await page.screenshot({
      path: 'private/purchase-table-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 800 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await expect(
      page.getByRole('searchbox', { name: d.purchases.search }),
    ).toBeInViewport()
    await page.screenshot({
      path: 'private/purchase-table-mobile.png',
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
