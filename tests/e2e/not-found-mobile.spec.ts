import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const

test('missing pages preserve the selected language and offer a clear mobile return action', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  for (const locale of locales) {
    await test.step(locale, async () => {
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
      const response = await page.goto('/missing-page-local-test')
      expect(response?.status()).toBe(404)
      await expect(
        page.getByRole('heading', { name: d.notFound, exact: true }),
      ).toBeVisible()
      const back = page.getByRole('link', { name: d.back, exact: true })
      await expect(back).toHaveAttribute('href', '/')
      const box = (await back.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(320)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.keyboard.press('Tab')
      await expect(back).toBeFocused()
    })
  }
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/login/)
})
