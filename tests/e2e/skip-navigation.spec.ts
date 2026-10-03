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
    await f.item('Synthetic navigation jacket')
    const bag = (
      await f.db.query(
        'select id from bag_receipts where tenant_id=$1 limit 1',
        [f.tenant],
      )
    ).rows[0].id
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
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/intake/items')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        if (width === 320) {
          const links = await page
            .locator('.mobile-nav .nav-link')
            .evaluateAll((elements) =>
              elements.map((element) => {
                const bounds = element.getBoundingClientRect()
                return {
                  width: bounds.width,
                  height: bounds.height,
                  left: bounds.left,
                  right: bounds.right,
                  overflow: element.scrollWidth > element.clientWidth,
                  fontSize: parseFloat(getComputedStyle(element).fontSize),
                }
              }),
            )
          for (const [index, link] of links.entries()) {
            expect(link.width).toBeGreaterThanOrEqual(44)
            expect(link.height).toBeGreaterThanOrEqual(44)
            expect(link.fontSize).toBeGreaterThanOrEqual(12)
            expect(link.overflow).toBe(false)
            expect(link.left).toBeGreaterThanOrEqual(
              index ? links[index - 1].right - 1 : 0,
            )
            expect(link.right).toBeLessThanOrEqual(width)
          }
          if (locale === 'fi')
            await page.screenshot({
              path: 'private/navigation-fi-320.png',
              caret: 'initial',
            })
        }
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
    for (const path of [
      '/intake/quick',
      '/intake/stock',
      `/intake/bags/${bag}/inspect`,
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('main')).toHaveCount(1)
      await expect(page.getByRole('main')).toHaveAttribute('id', 'main-content')
    }
  } finally {
    await f.close()
  }
})
