import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'

test('keyboard users can bypass store navigation in every interface language', async ({
  page,
}) => {
  const email = `skip-navigation-${randomUUID()}@example.test`
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
      await page
        .context()
        .addCookies([
          {
            name: 'komisio-locale',
            value: locale,
            url: 'http://127.0.0.1:3000',
          },
        ])
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/intake/items')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        const skip = page.getByRole('link', {
          name: d.skipToContent,
          exact: true,
        })
        await page.keyboard.press('Tab')
        await expect(skip).toBeFocused()
        await expect(skip).toBeInViewport()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('main')).toBeFocused()
        await page.keyboard.press('Tab')
        expect(
          await page.evaluate(() => !!document.activeElement?.closest('main')),
        ).toBe(true)
      }
    }
  } finally {
    await f.close()
  }
})
