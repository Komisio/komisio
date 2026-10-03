import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

// Read/type/resize only: no label settings, template or printer jobs are saved.
for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
  test(`tablet headers and label settings stay usable (${locale})`, async ({
    page,
  }, testInfo) => {
    const email = `tablet-workspace-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      for (const path of [
        '/intake/quick',
        '/intake/agreements',
        '/settings?tab=printing',
      ]) {
        await page.goto(path)
        await expect(page.locator('h1')).toBeVisible()
        let initialWidth = ''
        const printing = path.startsWith('/settings')
        if (printing) {
          await page.locator('.label-formats-fold > summary').click()
          await page.locator('.label-templates-fold > summary').click()
          initialWidth = await page
            .locator('.label-format input')
            .first()
            .inputValue()
          await page.locator('.label-format input').first().fill('61')
        }
        for (const width of [701, 768, 1000, 1024, 1280]) {
          await page.setViewportSize({ width, height: 1000 })
          await expect
            .poll(() =>
              page.evaluate(() => document.documentElement.scrollWidth),
            )
            .toBeLessThanOrEqual(width)
          const search = page.locator('.topbar-search input')
          const box = (await search.boundingBox())!
          expect(
            box.width,
            `${locale} ${path} ${width} search width`,
          ).toBeGreaterThanOrEqual(159.9)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
          const tools = (await page.locator('.topbar-tools').boundingBox())!
          expect(tools.x + tools.width).toBeLessThanOrEqual(width)
          if (width <= 1000)
            expect(box.y).toBeGreaterThanOrEqual(tools.y + tools.height)
          if (printing) {
            await expect(
              page.locator('.label-format input').first(),
            ).toHaveValue('61')
            for (const field of await page
              .locator('.label-format input')
              .all()) {
              const fieldBox = (await field.boundingBox())!
              expect(fieldBox.width).toBeGreaterThanOrEqual(80)
              expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(width)
            }
            if (width < 1000) {
              const row = page.locator('.label-format').first()
              const kind = (await row
                .locator('.label-format-kind')
                .boundingBox())!
              const size = (await row.locator('input').first().boundingBox())!
              expect(kind.y + kind.height).toBeLessThanOrEqual(size.y)
              expect(kind.width).toBeGreaterThan(size.width)
            }
            if (width <= 1000) {
              const columns = await page
                .locator('.label-template-editor')
                .evaluate(
                  (el) =>
                    getComputedStyle(el).gridTemplateColumns.split(' ').length,
                )
              expect(columns).toBe(1)
            }
          }
          if (locale === 'sv' && width === 768)
            await page.screenshot({
              path: testInfo.outputPath(
                `${printing ? 'printing' : path.split('/').at(-1)}-768.png`,
              ),
              fullPage: true,
            })
        }
        // Restore the initial value before navigating away from a typed draft.
        if (printing)
          await page.locator('.label-format input').first().fill(initialWidth)
      }
    } finally {
      await f.close()
    }
  })
}
