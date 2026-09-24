import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('connections overview shows simple setup guidance before detailed controls', async ({
  page,
}) => {
  const email = `integrations-gui-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/integrations')
    await expect(
      page.getByRole('heading', { name: d.nav.integrations, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'PayPal POS', exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: 'PayPal POS', exact: true })
        .getByText(d.zettle.setupHint, { exact: true }),
    ).toBeVisible()
    for (const category of [
      d.integrationPage.pos,
      d.integrationPage.ecommerce,
      d.integrationPage.accounting,
    ]) {
      await expect(
        page.getByRole('heading', { name: category, exact: true }),
      ).toBeVisible()
    }
    await expect(
      page
        .getByRole('region', {
          name: d.integrationPage.accounting,
          exact: true,
        })
        .getByRole('heading', { name: d.fortnox.title, exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: d.integrationPage.ecommerce, exact: true })
        .getByRole('heading', { name: d.shopify.title, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: d.integrationPage.accountingSettings }),
    ).toHaveAttribute('href', '/intake/accounting?view=settings')
    expect(await page.locator('main').first().innerText()).not.toContain(
      'Zettle',
    )

    await expect(
      page.locator('.integration-details').first(),
    ).not.toHaveAttribute('open', '')
    expect(await page.locator('main').first().innerText()).not.toMatch(/pilot/i)
    await page.screenshot({
      path: 'private/integrations-overview-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/integrations-overview-mobile.png',
      fullPage: true,
    })
    await page
      .getByText(`PayPal POS · ${d.integrationPage.manage}`, { exact: true })
      .click()
    await expect(page.getByText(d.zettle.recent, { exact: true })).toBeVisible()
    await page.goto('/api/integrations/fortnox/callback?error=access_denied')
    await expect(page).toHaveURL(
      /\/intake\/integrations\?fortnox=FORTNOX_AUTH_REQUIRED$/,
    )
    await expect(
      page
        .getByRole('region', { name: d.fortnox.title, exact: true })
        .getByRole('alert'),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
