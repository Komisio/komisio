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
    ).toContainText('200,00 kr')
    await page
      .getByRole('tab', { name: d.stock.tabs.categories, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.stock.categoriesHeading }),
    ).toContainText('Jackets')
    await expect(page.locator('.stock-details')).not.toHaveAttribute('open', '')
    await page
      .getByRole('tab', { name: d.stock.tabs.overview, exact: true })
      .click()
    await page.screenshot({
      path: 'private/stock-overview-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const stageCards = page.locator('.stock-stage-grid')
    expect(
      await stageCards.evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true)
    await stageCards.locator('article').last().scrollIntoViewIfNeeded()
    await expect(stageCards.locator('article').last()).toBeInViewport()
    await stageCards.locator('article').first().scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/stock-overview-mobile.png',
      fullPage: true,
    })
    await page
      .getByRole('tab', { name: d.stock.tabs.categories, exact: true })
      .click()
    const categoryTable = page.getByRole('region', {
      name: d.stock.categoriesHeading,
    })
    await expect(categoryTable).toContainText('Jackets')
    await expect(categoryTable.locator('td').first()).toHaveAttribute(
      'data-label',
      d.stock.inStock,
    )
    expect(
      await categoryTable.evaluate((el) => el.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390)
    await page
      .getByRole('tab', { name: d.stock.tabs.sales, exact: true })
      .click()
    await page.getByLabel(d.economy.from, { exact: true }).fill('2020-01-01')
    await page.getByLabel(d.economy.to, { exact: true }).fill('2020-01-31')
    await page
      .locator('.stock-period')
      .getByRole('button', { name: d.economy.show, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.stock.current, includeHidden: true }),
    ).toContainText('200,00 kr')
    await page.locator('.stock-details summary').click()
    await expect(
      page.getByText(d.stock.definitions, { exact: true }),
    ).not.toBeVisible()
    const help = page.getByRole('button', {
      name: d.stock.metricsHelpLabel,
      exact: true,
    })
    await help.focus()
    await page.keyboard.press('Enter')
    await expect(help).toHaveAttribute('aria-expanded', 'true')
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

test('an empty stock overview offers quick intake', async ({ page }) => {
  const email = `stock-empty-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/stock')
    const empty = page.locator('.stock-empty')
    await expect(empty).toContainText(d.stock.empty)
    await expect(
      empty.getByRole('link', { name: d.quickIntake.title, exact: true }),
    ).toHaveAttribute('href', '/intake/quick')
  } finally {
    await f.close()
  }
})
