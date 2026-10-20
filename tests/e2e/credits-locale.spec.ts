import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { dictionary } from '../../lib/i18n'

test('Danish credits use Danish number formatting without purchasing', async ({
  page,
  baseURL,
}) => {
  const email = `credits-locale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page
      .context()
      .addCookies([{ name: 'komisio-locale', value: 'dk', url: baseURL! }])
    await page.goto('/settings?tab=credits')
    await expect(page.getByText(/cirka 4\.000 modtagne varer/)).toBeVisible()
  } finally {
    await f.close()
  }
})

test('credit purchase shows tax-exclusive copy and a localized configuration error', async ({
  page,
  baseURL,
}) => {
  const email = `credits-tax-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let enabled: boolean | undefined
  try {
    await f.commit()
    enabled = (
      await f.db.query('select ai_credits_enabled from platform_settings')
    ).rows[0].ai_credits_enabled
    await f.db.query('update platform_settings set ai_credits_enabled=true')
    await page.route('**/api/billing', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'STRIPE_TAX_MISCONFIGURED' }),
      }),
    )
    for (const locale of [
      'sv',
      'en',
      'no',
      'dk',
      'fi',
      'de',
      'es',
      'it',
    ] as const) {
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: baseURL! }])
      await page.goto('/settings?tab=credits')
      const d = dictionary(locale).credits
      const panel = page.getByRole('region', { name: d.title, exact: true })
      const prefix = d.buy.split('{')[0]
      const buy = panel.getByRole('button').filter({ hasText: prefix })
      await expect(buy).toBeVisible()
      await expect(buy).toContainText(d.buy.slice(d.buy.lastIndexOf('}') + 1))
      await buy.click()
      await expect(
        panel.getByText(d.taxMisconfigured, { exact: true }),
      ).toBeVisible()
    }
  } finally {
    await page.unroute('**/api/billing')
    if (enabled !== undefined)
      await f.db.query('update platform_settings set ai_credits_enabled=$1', [
        enabled,
      ])
    await f.close()
  }
})
