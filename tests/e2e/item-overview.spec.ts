import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('item overview puts current facts first and keeps terms and history accessible', async ({
  page,
}, testInfo) => {
  const email = 'item-overview-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Restored vintage oak chair')
    await f.db.query('select set_item_price($1,$2,$3,12345,$4)', [
      f.tenant,
      randomUUID(),
      item,
      'Synthetic price change',
    ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/items/' + item)
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Restored vintage oak chair',
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.item-detail-price')).toContainText('123.45 SEK')
    const print = page.getByRole('link', {
      name: d.printing.browserOpen,
      exact: true,
    })
    await expect(print).toBeVisible()
    expect((await print.boundingBox())!.y).toBeLessThan(650)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const terms = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: d.items.terms }),
    })
    await expect(terms).not.toHaveAttribute('open', '')
    const summary = terms.locator('summary')
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(terms).toHaveAttribute('open', '')
    await expect(
      terms.getByText(d.items.termsHint, { exact: true }),
    ).toBeVisible()
    await summary.click()
    const history = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: d.items.prices }),
    })
    await history.locator('summary').click()
    await expect(history).toContainText('200.00 SEK')
    await expect(history).toContainText('123.45 SEK')
    await history.locator('summary').click()
    await page.screenshot({
      path: testInfo.outputPath('item-overview-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({
      path: testInfo.outputPath('item-overview-desktop.png'),
      fullPage: true,
      caret: 'initial',
    })
  } finally {
    await f.close()
  }
})
