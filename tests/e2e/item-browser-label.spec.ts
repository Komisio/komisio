import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff print an item label with the current price without configuring a printer', async ({
  page,
}, testInfo) => {
  const email = 'browser-label-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Vintage oak chair — comfortable and restored')
    await f.db.query('select set_item_price($1,$2,$3,12345,$4)', [
      f.tenant,
      randomUUID(),
      item,
      'Synthetic current price',
    ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/items/' + item)
    await page
      .getByRole('link', { name: d.printing.browserOpen, exact: true })
      .click()
    const label = page.locator('.item-browser-label')
    await expect(label).toContainText('123.45 SEK')
    await expect(label).toContainText('Vintage oak chair')
    await expect(label).toContainText('I-' + item.slice(0, 8).toUpperCase())
    await expect
      .poll(() =>
        label
          .locator('img')
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('item-label-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    // Exercise the button without sending a job to any actual printer.
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = 'true'
      }
    })
    await page
      .getByRole('button', { name: d.printing.browserPrint, exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute(
      'data-print-requested',
      'true',
    )
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('.topbar')).toBeHidden()
    await expect(
      page.getByRole('button', { name: d.printing.browserPrint, exact: true }),
    ).toBeHidden()
    await expect(label).toBeVisible()
    expect((await label.boundingBox())!.width).toBeCloseTo((80 * 96) / 25.4, 0)
    await page.screenshot({
      path: testInfo.outputPath('item-label-print.png'),
      fullPage: true,
      caret: 'initial',
    })
    await page.emulateMedia({ media: 'screen' })
    await page
      .getByRole('link', { name: d.printing.browserBack, exact: true })
      .click()
    await expect(page).toHaveURL('/intake/items/' + item)
  } finally {
    await f.close()
  }
})
