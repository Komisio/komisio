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
      await f.db.query("select save_profile('Synthetic Alex','sv')")
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
      expect(
        await page
          .locator('.item-quick-facts dt')
          .evaluateAll((labels) =>
            labels.every((label) => label.scrollWidth <= label.clientWidth),
          ),
      ).toBe(true)
      const print = page.getByRole('link', {
        name: d.printing.browserOpen,
        exact: true,
      })
      const printMenu = page.locator('.item-print-options > summary')
      await expect(print).not.toBeVisible()
      await printMenu.click()
      await expect(print).toBeVisible()
      expect((await print.boundingBox())!.y).toBeLessThan(650)
      await page
        .getByRole('button', { name: d.printing.zebraPrint, exact: true })
        .click()
      await expect(
        page.getByRole('dialog', { name: d.printing.zebraPrint }),
      ).toBeVisible()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: d.printing.close, exact: true })
        .click()
      await expect(print).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await printMenu.focus()
      await page.keyboard.press('Escape')
      await expect(print).not.toBeVisible()
      await page
        .getByRole('tab', { name: d.itemDetail.terms, exact: true })
        .click()
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
      await page.screenshot({
        path: testInfo.outputPath('item-terms-mobile.png'),
        fullPage: true,
      })
      await summary.click()
      await page
        .getByRole('tab', { name: d.itemDetail.history, exact: true })
        .click()
      const history = page.locator('details').filter({
        has: page.locator('summary').filter({ hasText: d.items.prices }),
      })
      await history.locator(':scope > summary').click()
      await expect(history).toContainText('200.00 ' + currency)
      await expect(history).toContainText('123.45 ' + currency)
      await expect(history).toContainText(d.items.priceReasons.manual)
      const signature = history.locator('.actor-signature').first()
      await expect(signature.locator('summary')).toHaveText('SA')
      await signature.locator('summary').focus()
      await page.keyboard.press('Enter')
      await expect(signature.locator('.actor-signature-name')).toHaveText(
        'Synthetic Alex',
      )
      await expect(signature.locator('.actor-signature-name')).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('item-signature-mobile.png'),
        fullPage: true,
      })
      await history.locator(':scope > summary').click()
      await page
        .getByRole('tab', { name: d.itemDetail.overview, exact: true })
        .click()
      await page.screenshot({
        path: testInfo.outputPath('item-overview-mobile.png'),
        fullPage: true,
        caret: 'initial',
      })
      await page.getByRole('tab', { name: /^Bilder/ }).click()
      await expect(
        page.getByRole('button', { name: d.itemPhotos.add, exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText(d.itemPhotos.noFile, { exact: true }),
      ).toBeVisible()
      await expect(page.locator('#item-photo-file')).toHaveClass('sr-only')
      await page.reload()
      await expect(page.getByRole('tab', { name: /^Bilder/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.goto('/intake/items/' + item + '#sync-status')
      await expect(
        page.getByRole('tab', { name: d.itemDetail.sync, exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await page
        .getByRole('tab', { name: d.itemDetail.overview, exact: true })
        .click()
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
