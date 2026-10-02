import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'

test('general integration help stays relevant and preserves the selected provider', async ({
  page,
}) => {
  const email = `integration-help-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    let integrationWrites = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/api/integrations')
      )
        integrationWrites++
    })
    await page.setViewportSize({ width: 320, height: 800 })
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
      await page.goto('/intake/integrations?provider=paypal')
      const provider = page.getByTestId('integration-paypal')
      await expect(provider).toHaveAttribute('open', '')
      const help = page.getByRole('button', {
        name: d.helpCenter.title,
        exact: true,
      })
      await help.click()
      const dialog = page.getByRole('dialog', {
        name: d.helpCenter.articles.integrations.title,
        exact: true,
      })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('.help-article ol > li')).toHaveCount(4)
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true)
      await page.keyboard.press('Escape')
      await expect(help).toBeFocused()
      await expect(provider).toHaveAttribute('open', '')
      await expect(page).toHaveURL(/provider=paypal$/)
      await page.goto('/help')
      const card = page.getByRole('link', {
        name: d.helpCenter.articles.integrations.title,
        exact: true,
      })
      // The description is part of the same generous click target as the heading.
      await card.locator('p').click()
      await expect(page).toHaveURL(/\/help\/integrations$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        d.helpCenter.articles.integrations.title,
      )
      await expect(
        page.getByRole('link', {
          name: d.helpCenter.integrations,
          exact: true,
        }),
      ).toHaveAttribute('href', '/intake/integrations')
    }
    expect(integrationWrites).toBe(0)
  } finally {
    await f.close()
  }
})
