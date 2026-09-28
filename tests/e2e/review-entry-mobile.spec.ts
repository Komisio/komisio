import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'

// A seller opening a review link on a phone without a session sees the
// sign-in and create-account choices. Both must stay inside the card in
// every language, keep their 44 px height and carry the exact review path
// as the next destination. No session, no review row, no real token: the
// unauthenticated branch renders for any well-formed token.
const token = 'a'.repeat(64)
const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const

test('anonymous review entry keeps sign-in and create-account inside the card on a phone', async ({
  page,
}, testInfo) => {
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
      await page.goto(`/review/${token}`)
      const card = page.locator('main.seller-review > section.card').first()
      const login = card.getByRole('link', { name: d.login, exact: true })
      const register = card.getByRole('link', {
        name: d.register,
        exact: true,
      })
      const next = encodeURIComponent(`/review/${token}`)
      await expect(login).toHaveAttribute('href', `/login?next=${next}`)
      await expect(register).toHaveAttribute('href', `/register?next=${next}`)
      const cardBox = (await card.boundingBox())!
      const padding = await card.evaluate(
        (el) => parseFloat(getComputedStyle(el).paddingLeft) || 0,
      )
      const contentLeft = cardBox.x + padding
      const contentRight = cardBox.x + cardBox.width - padding
      for (const [label, link] of [
        ['login', login],
        ['register', register],
      ] as const) {
        const box = (await link.boundingBox())!
        expect(box.height, `${locale} ${label} height`).toBeGreaterThanOrEqual(
          44,
        )
        expect(box.x, `${locale} ${label} left`).toBeGreaterThanOrEqual(
          contentLeft - 0.5,
        )
        expect(
          box.x + box.width,
          `${locale} ${label} right ${Math.round(box.x + box.width)} vs card content ${Math.round(contentRight)}`,
        ).toBeLessThanOrEqual(contentRight + 0.5)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${locale} page width`,
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`review-entry-320-${locale}.png`),
        fullPage: true,
        caret: 'initial',
      })
    })
  }
})
