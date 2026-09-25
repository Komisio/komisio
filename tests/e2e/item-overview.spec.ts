import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const currency of ['SEK', 'USD']) {
  test(`item overview keeps facts and history accessible (${currency})`, async ({
    page,
  }, testInfo) => {
    const email = 'item-overview-' + randomUUID() + '@example.test'
    await register(page, email, 'K!' + randomBytes(16).toString('hex'))
    const f = await p2Fixture(email)
    try {
      await f.db.query(
        "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || jsonb_build_object('currency',$3::text))",
        [f.tenant, randomUUID(), currency],
      )
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
      await expect(page.locator('.item-detail-price')).toContainText(
        '123.45 ' + currency,
      )
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
      await expect(history).toContainText('200.00 ' + currency)
      await expect(history).toContainText('123.45 ' + currency)
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
}
