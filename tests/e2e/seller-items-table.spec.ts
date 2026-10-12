import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller table searches and sorts across pages while preserving seller scope and tab', async ({
  page,
}, testInfo) => {
  const email = `seller-table-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let n = 0; n < 28; n++) {
      const item = await f.item(`Coat ${String(n).padStart(2, '0')}`)
      await f.db.query('select set_item_price($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        item,
        1000 + n * 100,
        'Synthetic price',
      ])
    }
    await f.commit()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(
      `/intake/sellers/${f.seller}?itemsSort=title&itemsDirection=asc#seller-items`,
    )
    const panel = page.getByRole('tabpanel')
    const rows = panel.locator('tbody tr')
    await expect(rows).toHaveCount(25)
    await expect(rows.first()).toContainText('Coat 00')
    await expect(panel.getByRole('columnheader').nth(1)).toContainText(
      d.quickIntake.price,
    )
    await expect(rows.first().getByRole('cell').first()).toHaveText('10.00 SEK')
    await expect
      .poll(async () => (await rows.first().boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(50)
    await panel
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(rows).toHaveCount(3)
    await expect(rows.first()).toContainText('Coat 25')
    await panel
      .getByRole('link', {
        name: `${d.quickIntake.price}: ${d.items.directory.sortAsc}`,
        exact: true,
      })
      .click()
    await expect(rows).toHaveCount(25)
    await expect(rows.first().locator('.inventory-price')).toHaveText(
      '10.00 SEK',
    )
    await panel
      .getByRole('link', {
        name: `${d.quickIntake.price}: ${d.items.directory.sortDesc}`,
        exact: true,
      })
      .click()
    await expect(rows.first().locator('.inventory-price')).toHaveText(
      '37.00 SEK',
    )
    await expect(panel.locator('th[aria-sort="descending"]')).toContainText(
      d.quickIntake.price,
    )
    await page.screenshot({
      path: testInfo.outputPath('seller-items-desktop.png'),
      fullPage: true,
    })
    await panel.getByRole('searchbox').fill('coat 00')
    await panel
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Coat 00')
    await expect(page).toHaveURL(/#seller-items$/)
    await page.reload()
    await expect(panel.getByRole('searchbox')).toHaveValue('coat 00')
    await panel.getByLabel(d.items.stage, { exact: true }).selectOption('sold')
    await panel
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(panel).toContainText(d.items.noMatches)
    await panel
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(rows).toHaveCount(25)
    await expect(panel.getByRole('searchbox')).toHaveValue('')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    await expect(panel.locator('.seller-summary-grid')).toContainText('28')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.items, exact: true })
      .click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rows.first().getByRole('link')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('seller-items-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
