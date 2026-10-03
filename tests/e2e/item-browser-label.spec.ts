import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { decodeRenderedCode128 } from '../helpers/rendered-barcode'
import d from '../../messages/sv.json' with { type: 'json' }

// Software acceptance of the browser label: the pixels the browser shows are
// decoded independently (no source SVG, no resizing) and the decoded text is
// the only thing used to reach the item through the scan route. This proves
// nothing about a physical printer or scanner.
test('staff print an item label with the current price without configuring a printer', async ({
  page,
  browser,
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
    const reference = 'I-' + item.slice(0, 8).toUpperCase()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/items/' + item)
    await page
      .getByRole('link', { name: d.printing.browserOpen, exact: true })
      .click()
    const label = page.locator('.item-browser-label')
    await expect(label).toContainText('123.45 SEK')
    await expect(label).toContainText('Vintage oak chair')
    await expect(label).toContainText(reference)
    const img = label.locator('img')
    await expect
      .poll(() =>
        img.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true)
    // The rendered barcode on a 320 px screen decodes to this item's reference.
    const screenShot = await img.screenshot()
    await testInfo.attach('barcode-screen.png', {
      body: screenShot,
      contentType: 'image/png',
    })
    const screen = await decodeRenderedCode128(screenShot)
    expect(screen.text).toBe(reference)
    expect(screen.width).toBeLessThanOrEqual(320)
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
    // Dashboard banners are optional siblings of the page, not label content.
    await page.locator('main').evaluate((main) => {
      const banner = document.createElement('p')
      banner.className = 'intake-notice'
      banner.dataset.testPrintBanner = 'true'
      banner.textContent = 'Synthetic subscription reminder'
      main.prepend(banner)
    })
    await expect(page.locator('[data-test-print-banner]')).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('[data-test-print-banner]')).toBeHidden()
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('.topbar')).toBeHidden()
    await expect(
      page.getByRole('button', { name: d.printing.browserPrint, exact: true }),
    ).toBeHidden()
    await expect(label).toBeVisible()
    expect((await label.boundingBox())!.x).toBeLessThanOrEqual(1)
    expect((await label.boundingBox())!.width).toBeCloseTo((80 * 96) / 25.4, 0)
    await page.screenshot({
      path: testInfo.outputPath('item-label-print.png'),
      fullPage: true,
      caret: 'initial',
    })
    // The barcode as laid out for an 80 mm label decodes to the same reference.
    const printShot = await img.screenshot()
    await testInfo.attach('barcode-print.png', {
      body: printShot,
      contentType: 'image/png',
    })
    const printed = await decodeRenderedCode128(printShot)
    expect(printed.text).toBe(reference)
    await page.emulateMedia({ media: 'screen' })
    await page
      .getByRole('link', { name: d.printing.browserBack, exact: true })
      .click()
    await expect(page).toHaveURL('/intake/items/' + item)

    // A scanner opens the decoded text as a URL; the existing scan route hands
    // it to the store-scoped lookup, which lands on exactly this item.
    const hop = await page.request.get('/scan?ref=' + screen.text, {
      maxRedirects: 0,
    })
    expect([302, 307]).toContain(hop.status())
    expect(hop.headers()['location']).toBe(
      'http://127.0.0.1:3000/intake/open?ref=' + reference,
    )
    expect(hop.headers()['cache-control']).toContain('no-store')
    await page.goto('/scan?ref=' + screen.text)
    await expect(page).toHaveURL('/intake/items/' + item)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Vintage oak chair',
    )
    // A malformed reference never reaches the lookup.
    expect(
      (
        await page.request.get('/scan?ref=I-1234567', { maxRedirects: 0 })
      ).status(),
    ).toBe(400)
    // Without a session the same code only leads to login, with the exact
    // destination preserved and nothing else.
    const anonymous = await browser.newContext()
    try {
      const login = await anonymous.request.get(
        'http://127.0.0.1:3000/scan?ref=' + screen.text,
        { maxRedirects: 0 },
      )
      expect([302, 307]).toContain(login.status())
      expect(login.headers()['location']).toBe(
        'http://127.0.0.1:3000/login?next=' +
          encodeURIComponent('/intake/open?ref=' + reference),
      )
    } finally {
      await anonymous.close()
    }
    // Staff of another store scanning the same label reach nothing: the
    // lookup is bound to their own store.
    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    const otherEmail = 'browser-label-other-' + randomUUID() + '@example.test'
    await register(
      otherPage,
      otherEmail,
      'K!' + randomBytes(16).toString('hex'),
    )
    const other = await p2Fixture(otherEmail)
    try {
      await other.commit()
      await otherPage.goto('/scan?ref=' + screen.text)
      await expect(otherPage).toHaveURL('/intake/open?ref=' + reference)
      await expect(
        otherPage.getByText(
          d.openByReference.notFound.replace('{ref}', reference),
          { exact: true },
        ),
      ).toBeVisible()
      await expect(otherPage).not.toHaveURL(/\/intake\/items\//)
    } finally {
      await other.close()
      await otherContext.close()
    }
  } finally {
    await f.close()
  }
})
