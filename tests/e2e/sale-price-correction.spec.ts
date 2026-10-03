import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('an invalid manual-sale price focuses its cart item before one corrected sale is recorded', async ({
  page,
}, testInfo) => {
  const email = `sale-price-focus-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const first = await f.item('Synthetic price correction coat')
    const second = await f.item('Synthetic price correction lamp')
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/sales')
    await page.locator('.sale-manual > summary').click()
    const search = page.getByLabel(d.sales.search, { exact: true })
    await search.fill('Synthetic price correction')
    await search.press('Enter')
    for (const title of [
      'Synthetic price correction coat',
      'Synthetic price correction lamp',
    ]) {
      await page
        .locator('.sale-search-results li')
        .filter({ hasText: title })
        .getByRole('button', { name: d.sales.add, exact: true })
        .click()
    }
    await page.locator(`#price-${first}`).fill('25.25')
    const incorrect = page.locator(`#price-${second}`)
    await incorrect.fill('12,345')
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    const requests: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/intake') && request.method() === 'POST')
        requests.push(request.postDataJSON())
    })
    const record = page.getByRole('button', {
      name: d.sales.record,
      exact: true,
    })
    await record.click()
    await expect(incorrect).toBeFocused()
    await expect(incorrect).toHaveAttribute('aria-invalid', 'true')
    await expect(incorrect).toHaveAccessibleDescription(d.sales.priceInvalid)
    await expect(page.locator(`#price-${first}`)).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(requests).toHaveLength(0)
    const box = (await incorrect.boundingBox())!
    const menu = (await page.locator('.mobile-nav').boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(menu.y)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320)
    await page.screenshot({
      path: testInfo.outputPath('cart-price-correction.png'),
    })
    await incorrect.fill('150,50')
    await expect(incorrect).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('.sale-cart [role="alert"]')).toHaveCount(0)
    await record.click()
    await expect(
      page.getByRole('link', { name: d.sales.open, exact: true }),
    ).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(
      (
        await f.db.query(
          'select item_id,price_ore::text from sale_lines where tenant_id=$1 order by sale_lines.price_ore',
          [f.tenant],
        )
      ).rows,
    ).toEqual([
      { item_id: first, price_ore: '2525' },
      { item_id: second, price_ore: '15050' },
    ])
  } finally {
    await f.close()
  }
})
