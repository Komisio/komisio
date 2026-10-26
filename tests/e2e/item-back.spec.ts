import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('item back control restores filtered page and row, including refresh and a new tab', async ({
  page,
}, testInfo) => {
  const email = `item-back-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 29; i++)
      await f.item(`Return coat ${String(i).padStart(2, '0')}`)
    await f.item('Unrelated item')
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    const listing =
      '/intake/items?q=Return&stage=markdown_due&sort=title&direction=asc&page=2'
    await page.goto(listing)
    const rows = page.locator('.inventory-row')
    await expect(rows).toHaveCount(4)
    const link = rows.last().locator('.inventory-open-item')
    const href = (await link.getAttribute('href'))!
    const destination = new URL(href, page.url())
    const returnTo = destination.searchParams.get('returnTo')!
    await link.click()
    await expect(page).toHaveURL(destination.href)
    const back = page.getByRole('link', {
      name: d.returnNavigation.back,
      exact: true,
    })
    await expect(back).toBeVisible()
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({
      path: testInfo.outputPath('item-back-mobile.png'),
      fullPage: true,
    })
    await page.reload()
    await expect(back).toHaveAttribute('href', returnTo)
    await back.click()
    await expect(page).toHaveURL(new URL(returnTo, page.url()).href)
    await expect(rows).toHaveCount(4)
    await expect(page.getByLabel(d.items.search, { exact: true })).toHaveValue(
      'Return',
    )
    await expect(page.getByLabel(d.items.stage, { exact: true })).toHaveValue(
      'markdown_due',
    )
    await expect(rows.last()).toBeInViewport()
    // A real href also carries the source into a new tab, without history state.
    const other = await page.context().newPage()
    await other.goto(destination.href)
    await other
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await expect(other).toHaveURL(new URL(returnTo, page.url()).href)
    await other.close()
    await page.goto(destination.pathname)
    await expect(back).toHaveAttribute('href', '/intake/items')
    await page.goto(
      destination.pathname + '?returnTo=https%3A%2F%2Fexample.com',
    )
    await expect(back).toHaveAttribute('href', '/intake/items')
    await back.click()
    await expect(page).toHaveURL(/\/intake\/items$/)
  } finally {
    await f.close()
  }
})
