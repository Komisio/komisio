import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

test('wide lists use desktop space while forms, details and mobile scrolling keep their bounds', async ({
  page,
}, testInfo) => {
  const email = `page-width-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic wide table coat')
    await f.commit()
    await page.setViewportSize({ width: 1920, height: 1080 })
    for (const path of [
      '/intake',
      '/intake/items',
      '/intake/stock',
      '/intake/sellers',
      '/intake/payouts',
      '/intake/sales',
      '/intake/lifecycle',
      '/intake/purchases',
      '/intake/agreements',
      '/intake/submissions',

      '/intake/handovers',
      '/intake/operations',
      '/intake/sellers/registrations',
      '/intake/economy',
      '/intake/stocktake',
      '/members',
      '/settings/activity',
    ]) {
      await page.goto(path)
      await expect(
        page.getByRole('combobox', { name: 'Aktiv butik' }).first(),
      ).toBeEnabled()
      await expect(page.locator('#main-content h1').first()).toBeVisible()
      const main = page.locator('#main-content')
      await expect(main).toHaveClass(/main--wide/)
      const box = (await main.boundingBox())!
      expect(box.width, path).toBeGreaterThan(1400)
      expect(
        await main.evaluate((e) => getComputedStyle(e).paddingLeft),
        path,
      ).toBe('24px')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        path,
      ).toBe(true)
    }
    await page.goto('/intake/items')
    const table = page.locator('.inventory-table-scroll').first()
    await expect(page.locator('.inventory-row')).toHaveCount(1)
    expect(
      await table.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true)
    await expect(
      page.locator('.inventory-table thead th').last(),
    ).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath('inventory-wide-1920.png'),
      fullPage: true,
    })
    for (const path of [
      '/settings',
      '/intake/quick',
      '/intake/reception',
      '/intake/sellers/new',
      `/intake/items/${item}`,
      `/intake/sellers/${f.seller}`,
    ]) {
      await page.goto(path)
      await expect(
        page.getByRole('combobox', { name: 'Aktiv butik' }).first(),
      ).toBeEnabled()
      await expect(page.locator('#main-content h1').first()).toBeVisible()
      const main = page.locator('#main-content')
      await expect(main).toHaveClass(/main--reading/)
      expect((await main.boundingBox())!.width, path).toBeLessThanOrEqual(1120)
    }
    await page.goto('/intake/sales#sales-manual')
    await expect(page.locator('.sale-manual')).toBeVisible()
    expect(
      (await page.locator('.sale-manual').boundingBox())!.width,
    ).toBeLessThanOrEqual(1034)
    await page.goto('/intake/items')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.inventory-row')).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await expect
      .poll(() => table.evaluate((e) => e.scrollWidth > e.clientWidth))
      .toBe(true)
    await table.evaluate((e) => {
      e.scrollLeft = e.scrollWidth
    })
    await expect(
      page.locator('.inventory-table thead th').last(),
    ).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath('inventory-wide-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
    // Stop route prefetches before WebKit tears down this long navigation journey.
    await page.goto('about:blank')
  }
})
