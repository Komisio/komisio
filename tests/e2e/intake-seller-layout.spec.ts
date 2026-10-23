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
              height: box.height,
            }
          })
          expect(geometry.nameHeight).toBeLessThanOrEqual(
            geometry.lineHeight + 1,
          )
          expect(geometry.nameWidth).toBeGreaterThan(60)
          expect(geometry.actionRight).toBeLessThanOrEqual(geometry.rowRight)
          expect(geometry.height).toBeGreaterThanOrEqual(44)
          expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          )
          const placeholderFits = await search.evaluate((element) => {
            const input = element as HTMLInputElement
            const style = getComputedStyle(input)
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')!
            context.font = style.font
            return (
              context.measureText(input.placeholder).width <=
              input.clientWidth -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight) -
                20
            )
          })
          expect(placeholderFits).toBe(true)
          await expect(page.locator('#seller-search-hint')).toHaveText(
            d.sellersList.searchHint,
          )
          const searchButton = page
            .locator('form')
            .filter({ has: search })
            .getByRole('button')
          expect(
            (await searchButton.boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44)
          const registration = page.locator('.intake-registration > summary')
          await expect(registration).toHaveCount(1)
          expect(
            (await registration.boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44)
          await expect(
            page.getByRole('link', { name: d.intake.newSeller, exact: true }),
          ).toHaveCount(0)
          if (locale === 'sv' && viewport.width === 768 && !collapsed)
            await page.screenshot({
              path: testInfo.outputPath('seller-picker-ipad.png'),
              fullPage: true,
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
    } finally {
      await f.close()
    }
  })
}
