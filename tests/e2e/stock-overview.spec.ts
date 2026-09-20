import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('stock overview separates current inventory from period sales on desktop and mobile', async ({
  page,
}) => {
  const email = `stock-gui-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Synthetic stock lamp')
    await f.commit()
    await page.goto('/intake/stock')
    await expect(
      page.getByRole('region', { name: d.stock.current }),
    ).toContainText('200.00 SEK')
    await expect(
      page.getByRole('region', { name: d.stock.categoriesHeading }),
    ).toContainText('Jackets')
    await expect(page.locator('.stock-details')).not.toHaveAttribute('open', '')
    await page.screenshot({
      path: 'private/stock-overview-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/stock-overview-mobile.png',
      fullPage: true,
    })
    await page.getByLabel(d.economy.from, { exact: true }).fill('2020-01-01')
    await page.getByLabel(d.economy.to, { exact: true }).fill('2020-01-31')
    await page
      .getByRole('button', { name: d.economy.show, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.stock.current }),
    ).toContainText('200.00 SEK')
    await page.locator('.stock-details summary').click()
    await expect(
      page.getByText(d.stock.definitions, { exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})
