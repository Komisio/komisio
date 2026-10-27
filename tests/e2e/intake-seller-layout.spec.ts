import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { readFile } from 'node:fs/promises'
import type { Dictionary, Locale } from '../../lib/i18n'

for (const locale of [
  'sv',
  'en',
  'no',
  'dk',
  'fi',
  'de',
  'es',
  'it',
] as Locale[]) {
  test(`intake seller rows remain readable and selectable (${locale})`, async ({
    page,
  }, testInfo) => {
    const email = `intake-layout-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const d: Dictionary = JSON.parse(
      await readFile(`messages/${locale}.json`, 'utf8'),
    )
    try {
      const seller = (
        await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
          f.tenant,
          randomUUID(),
          'Synthetic Alexandersson-Lindgren',
          'synthetic.long.contact@example.test',
          '0701234567',
        ])
      ).rows[0].id
      await f.commit()
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.setViewportSize({ width: 768, height: 1024 })
      await page.goto('/intake?q=Synthetic%20Alexandersson')
      const row = page.locator('.intake-seller-results .intake-seller')
      await expect(row).toHaveCount(1)
      // Streamed content can exist in a hidden fragment before React reveals it.
      await expect(row).toBeVisible()
      const search = page.locator('#seller-search')
      for (const viewport of [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 1000 },
        { width: 320, height: 800 },
      ]) {
        await page.setViewportSize(viewport)
        const toggle = page.locator('.sidebar .sidebar-toggle')
        for (const collapsed of viewport.width > 700
          ? [false, true]
          : [false]) {
          if (viewport.width > 700) {
            if (
              (await toggle.getAttribute('aria-expanded')) !==
              String(!collapsed)
            )
              await toggle.click()
            await expect(toggle).toHaveAttribute(
              'aria-expanded',
              String(!collapsed),
            )
          }
          await expect
            .poll(() =>
              page.evaluate(() => document.documentElement.scrollWidth),
            )
            .toBeLessThanOrEqual(viewport.width)
          const geometry = await row.evaluate((element) => {
            const name = element.querySelector('strong')!
            const action = element.querySelector('span')!
            const box = element.getBoundingClientRect()
            const nameBox = name.getBoundingClientRect()
            const actionBox = action.getBoundingClientRect()
            return {
              nameHeight: nameBox.height,
              lineHeight: Number.parseFloat(getComputedStyle(name).lineHeight),
              nameWidth: nameBox.width,
              actionRight: actionBox.right,
              rowRight: box.right,
              rowWidth: box.width,
              listWidth: element.closest('ul')!.clientWidth,
              height: box.height,
            }
          })
          expect(geometry.nameHeight).toBeLessThanOrEqual(
            geometry.lineHeight + 1,
          )
          expect(geometry.nameWidth).toBeGreaterThan(60)
          expect(geometry.actionRight).toBeLessThanOrEqual(geometry.rowRight)
          // A single result must still use the entire list, not half a two-column grid.
          expect(geometry.rowWidth).toBeGreaterThanOrEqual(
            geometry.listWidth - 8,
          )
          expect(geometry.height).toBeGreaterThanOrEqual(44)
          expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          )
          await expect(search).toHaveAccessibleName(d.sellersList.search)
          await expect(search).toHaveAttribute(
            'placeholder',
            d.sellersList.searchHint,
          )
          await expect(page.locator('#seller-search-hint')).toHaveCount(0)
          await expect(
            page.getByRole('heading', { name: d.intake.find, exact: true }),
          ).toHaveCount(1)
          const widths = await page
            .locator('.intake-overview')
            .evaluate((element) => ({
              page: element.getBoundingClientRect().width,
              parent:
                element.parentElement!.getBoundingClientRect().width -
                parseFloat(
                  getComputedStyle(element.parentElement!).paddingLeft,
                ) -
                parseFloat(
                  getComputedStyle(element.parentElement!).paddingRight,
                ),
              tabs: element
                .querySelector('.workspace-tablist')!
                .getBoundingClientRect().width,
              card: element
                .querySelector('.intake-find-seller')!
                .getBoundingClientRect().width,
            }))
          expect(widths.page).toBeCloseTo(widths.parent, 0)
          if (viewport.width > 1000) {
            const main = page.getByRole('main')
            await expect(main).toHaveClass(/main--wide/)
            // Read both edges in the same frame while the sidebar animates.
            await expect
              .poll(() =>
                main.evaluate((element) => {
                  const mainBox = element.getBoundingClientRect()
                  const sidebarBox = document
                    .querySelector('.sidebar')!
                    .getBoundingClientRect()
                  return Math.max(
                    Math.abs(mainBox.left - sidebarBox.right),
                    Math.abs(mainBox.right - innerWidth),
                  )
                }),
              )
              .toBeLessThanOrEqual(0.5)
          }
          expect(widths.tabs).toBeCloseTo(widths.page, 0)
          expect(widths.card).toBeCloseTo(widths.page, 0)
          await expect(
            page.locator('form').filter({ has: search }).getByRole('button', {
              name: d.intake.searchButton,
              exact: true,
            }),
          ).toHaveCount(0)
          expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          )
          const registration = page.getByRole('link', {
            name: d.intake.newSellerAction,
            exact: true,
          })
          await expect(registration).toHaveCount(1)
          expect(
            (await registration.boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44)
          await expect(page.locator('.intake-registration')).toHaveCount(0)
          await expect(page.locator('#seller-name')).toHaveCount(0)
          if (
            locale === 'sv' &&
            [1440, 320].includes(viewport.width) &&
            !collapsed
          )
            await page.screenshot({
              path: testInfo.outputPath(`seller-picker-${viewport.width}.png`),
              fullPage: true,
              caret: 'initial',
            })
        }
      }
      // Match a real iPad tap in the WebKit project, including pointer/focus handling.
      if (testInfo.project.use.hasTouch) await row.tap()
      else await row.click()
      await expect(page).toHaveURL(`/intake?seller=${seller}#new-seller`)
      await expect(page.locator('.receiving-seller-context')).toContainText(
        'Synthetic Alexandersson-Lindgren',
      )
      if (locale === 'sv') {
        await page.goto('/intake')
        await expect(search).toHaveValue('')
        for (const width of [1920, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.screenshot({
            path: testInfo.outputPath(`seller-search-${width}.png`),
            fullPage: true,
            caret: 'initial',
          })
        }
      }
    } finally {
      await f.close()
    }
  })
}
