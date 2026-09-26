import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']

test.use({ timezoneId: 'America/Los_Angeles' })

test('members fit narrow screens and hydrate consistently in every language', async ({
  page,
}, info) => {
  const email = `mobile-members-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of locales) {
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      const response = await page.goto('/members')
      expect(response?.status()).toBe(200)
      await expect(page.locator('#invite-email')).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollWidth),
          locale,
        )
        .toBeLessThanOrEqual(320)
      await page.screenshot({
        path: info.outputPath(`members-${locale}.png`),
        fullPage: true,
      })
    }
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})
