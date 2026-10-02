import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
  test(`tabbing through long mobile forms keeps focused controls clear of navigation (${locale})`, async ({
    page,
  }) => {
    const email = `keyboard-visibility-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 640 })
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      for (const path of [
        '/settings?tab=profile',
        '/intake/sellers/new',
        '/account',
      ]) {
        await page.goto(path)
        await expect(page.locator('main input').first()).toBeVisible()
        await expect(page.locator('main input').first()).toBeEnabled()
        await page.getByRole('main').focus()
        let visited = 0
        for (let step = 0; step < 70; step++) {
          await page.keyboard.press('Tab')
          await page.evaluate(() => new Promise(requestAnimationFrame))
          const focused = await page.evaluate(() => {
            const target = document.activeElement as HTMLElement | null
            if (!target?.closest('main')) return null
            const rect = target.getBoundingClientRect()
            const nav = document
              .querySelector('.mobile-nav')!
              .getBoundingClientRect()
            const center = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            )
            return {
              tag: target.tagName,
              id: target.id,
              type: target.getAttribute('type'),
              fontSize: parseFloat(getComputedStyle(target).fontSize),
              top: rect.top,
              bottom: rect.bottom,
              navTop: nav.top,
              covered: !center || !target.contains(center),
            }
          })
          if (!focused) break
          visited++
          const context = `${locale} ${path} ${focused.tag}#${focused.id}`
          expect(focused.covered, context).toBe(false)
          expect(focused.top, context).toBeGreaterThanOrEqual(0)
          expect(focused.bottom, context).toBeLessThanOrEqual(focused.navTop)
          if (
            ['INPUT', 'SELECT', 'TEXTAREA'].includes(focused.tag) &&
            !['checkbox', 'radio'].includes(focused.type ?? '')
          )
            expect(focused.fontSize, context).toBeGreaterThanOrEqual(16)
        }
        expect(visited, `${locale} ${path}`).toBeGreaterThanOrEqual(5)
      }
    } finally {
      await f.close()
    }
  })
}
