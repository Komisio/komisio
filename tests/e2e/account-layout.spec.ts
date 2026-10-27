import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller and store account cards align and fill narrow screens', async ({
  page,
  browser,
}, info) => {
  const ownerEmail = `account-owner-${randomUUID()}@example.test`
  const sellerEmail = `account-seller-${randomUUID()}@example.test`
  await register(page, ownerEmail, `K!${randomUUID()}`)
  const f = await p2Fixture(ownerEmail)
  const sellerContext = await browser.newContext()
  try {
    await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      'Synthetic account seller',
      sellerEmail,
      '',
    ])
    await f.commit()
    const sellerPage = await sellerContext.newPage()
    await register(sellerPage, sellerEmail, `K!${randomUUID()}`, '/seller')
    for (const [role, account] of [
      ['seller', sellerPage],
      ['store', page],
    ] as const) {
      await account.goto('/account')
      await expect(
        account.getByRole('heading', { name: d.account, exact: true }),
      ).toBeVisible()
      await expect(
        account.getByLabel(d.displayName, { exact: true }),
      ).toBeEnabled()
      for (const width of [390, 320, 768, 1280]) {
        await account.setViewportSize({ width, height: 950 })
        const grid = account.locator('.settings-grid')
        const cards = grid.locator('section.card')
        await expect(cards).toHaveCount(4)
        const gridBox = (await grid.boundingBox())!
        const boxes = await cards.evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect()
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              width: r.width,
            }
          }),
        )
        if (width <= 1000) {
          for (const [index, box] of boxes.entries()) {
            expect(Math.abs(box.left - gridBox.x)).toBeLessThan(1)
            expect(Math.abs(box.width - gridBox.width)).toBeLessThan(1)
            if (index > 0)
              expect(box.top - boxes[index - 1].bottom).toBeCloseTo(24, 0)
          }
        } else {
          expect(boxes[0].top).toBe(boxes[1].top)
          expect(boxes[1].left - boxes[0].right).toBeCloseTo(24, 0)
          for (const box of boxes) {
            expect(box.width).toBeLessThanOrEqual(550)
            expect(Math.abs(box.width - boxes[0].width)).toBeLessThan(1)
          }
        }
        await expect(account.locator('.page-heading')).toHaveCSS(
          'text-align',
          'left',
        )
        const heading = (await account.locator('.page-heading').boundingBox())!
        expect(Math.abs(heading.x - gridBox.x)).toBeLessThan(1)
        if (role === 'seller') {
          const language = account.locator('main > .language-picker')
          const languageBox = (await language.boundingBox())!
          expect(Math.abs(languageBox.x - gridBox.x)).toBeLessThan(1)
          expect(languageBox.width).toBeLessThan(240)
          await language.locator('summary').click()
          const options = (await language
            .locator('.language-options')
            .boundingBox())!
          expect(options.x).toBeGreaterThanOrEqual(0)
          expect(options.x + options.width).toBeLessThanOrEqual(width)
          await language.locator('summary').click()
        }
        expect(
          await account.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        if (width === 390 || width === 1280) {
          await account.screenshot({
            path: info.outputPath(`${role}-account-${width}.png`),
            fullPage: true,
          })
        }
      }
    }
    // Only the account route gets the override; store creation stays readable.
    await page.goto('/onboarding')
    await expect(page.locator('.account-page')).toHaveCount(0)
    await expect(
      page.getByLabel('Butikens namn', { exact: true }),
    ).toBeEnabled()
  } finally {
    await sellerContext.close()
    await f.close()
  }
})
