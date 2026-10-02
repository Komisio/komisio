import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'

test('account mapping keeps amounts and complete debit-credit controls readable at narrow widths', async ({
  page,
}) => {
  const email = `map-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const d: Dictionary = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.goto('/intake/accounting?view=settings')
      const map = page.locator('#account-map')
      const account = map.getByLabel(d.accounting.amountKeys.grossOre, {
        exact: true,
      })
      const side = map.getByRole('combobox', {
        name: `${d.accounting.amountKeys.grossOre} ${d.accounting.side}`,
        exact: true,
      })
      await account.fill('1930')
      await side.selectOption('credit')
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await account.scrollIntoViewIfNeeded()
        await expect(account).toHaveValue('1930')
        await expect(side).toHaveValue('credit')
        const measure = await side.evaluate((element) => {
          const select = element as HTMLSelectElement
          const style = getComputedStyle(select)
          const context = document.createElement('canvas').getContext('2d')!
          context.font = `${style.fontSize} ${style.fontFamily}`
          return {
            available: select.clientWidth,
            needed:
              context.measureText(select.selectedOptions[0].text).width + 40,
          }
        })
        expect(measure.available).toBeGreaterThanOrEqual(measure.needed)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
        if (locale === 'sv')
          await page.screenshot({
            path: `private/account-map-after-${width}.png`,
            caret: 'initial',
          })
      }
    }
  } finally {
    await f.close()
  }
})
