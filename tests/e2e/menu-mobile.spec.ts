import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'
import { readFileSync } from 'node:fs'
import { buildNavigation } from '../../lib/platform/navigation'

const locales: Locale[] = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']

test('store menu keeps all destinations and comfortable targets on narrow screens', async ({
  page,
}, info) => {
  const email = `menu-${randomUUID()}@example.test`
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
      await page.goto('/menu')
      await page.waitForLoadState('networkidle')
      const d = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      ) as Dictionary
      const links = buildNavigation(d, {
        intakeEnabled: true,
        host: false,
      }).flatMap((g) => g.links)
      for (const link of [...links, { path: '/account', label: d.account }]) {
        const target = page.locator(`main a[href="${link.path}"]`)
        await expect(target).toHaveAccessibleName(link.label)
        const box = await target.boundingBox()
        expect(box?.height, `${locale} ${link.path}`).toBeGreaterThanOrEqual(44)
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        locale,
      ).toBeLessThanOrEqual(320)
      if (locale === 'sv') {
        // Measure menu density independently of the shell's accessible controls.
        // The old 1450px document budget included 230px of header/footer space.
        const height = await page
          .getByRole('main')
          .evaluate((main) => main.getBoundingClientRect().height)
        console.log('menu content height at 320px:', height)
        // Purchases adds one 44px destination; existing menu density is unchanged.
        expect(height).toBeLessThan(1220 + 44)
      }
      await page.screenshot({
        path: info.outputPath(`menu-${locale}.png`),
        fullPage: true,
        caret: 'initial',
      })
    }
    const purchases = page.locator('main a[href="/intake/purchases"]')
    await purchases.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/intake\/purchases$/)
    await expect(page.locator('.purchase-create > summary')).toBeVisible()
    await page.goto('/menu')
    const sellers = page.locator('main a[href="/intake/sellers"]')
    await sellers.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/intake\/sellers$/)
    const mobileCurrent = page.locator('.mobile-nav [aria-current]')
    await expect(mobileCurrent).toHaveCount(1)
    await expect(mobileCurrent).toHaveAttribute('href', '/menu')
    await expect(mobileCurrent).toHaveAttribute('aria-current', 'location')
    await page.goto('/intake')
    await expect(mobileCurrent).toHaveCount(1)
    await expect(mobileCurrent).toHaveAttribute('href', '/intake/quick')
    await expect(mobileCurrent).toHaveAttribute('aria-current', 'location')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.locator('.sidebar-nav [aria-current]')).toHaveCount(1)
    await expect(page.locator('.sidebar-nav [aria-current]')).toHaveAttribute(
      'href',
      '/intake',
    )
    await page.goto('/menu')
    await expect(page.locator('main a[href="/settings"]')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1440)
    await page.screenshot({
      path: info.outputPath('menu-desktop.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})
