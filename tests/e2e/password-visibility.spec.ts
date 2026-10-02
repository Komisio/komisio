import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'

test('password visibility works with keyboard and all languages without submitting or losing the value', async ({
  page,
}) => {
  let submitted = 0
  page.on('request', (request) => {
    if (request.method() === 'POST') submitted++
  })
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
        { name: 'komisio-locale', value: locale, url: 'http://127.0.0.1:3000' },
      ])
    for (const path of ['/login', '/register']) {
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(path)
      const password = page.getByLabel(d.password, { exact: true })
      await password.fill('Synthetic password for visibility')
      await expect(password).toHaveAttribute('type', 'password')
      await expect(password).toHaveAttribute(
        'autocomplete',
        path === '/login' ? 'current-password' : 'new-password',
      )
      await password.press('Tab')
      const show = page.getByRole('button', {
        name: d.showPassword,
        exact: true,
      })
      await expect(show).toBeFocused()
      const box = await show.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
      await show.press('Space')
      await expect(password).toHaveAttribute('type', 'text')
      await expect(password).toHaveValue('Synthetic password for visibility')
      await page
        .getByRole('button', { name: d.hidePassword, exact: true })
        .click()
      await expect(password).toHaveAttribute('type', 'password')
      await expect(password).toHaveValue('Synthetic password for visibility')
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      await expect(page).toHaveURL(`http://127.0.0.1:3000${path}`)
    }
  }
  expect(submitted).toBe(0)
})
