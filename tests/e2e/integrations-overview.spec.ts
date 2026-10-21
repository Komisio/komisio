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
    for (const provider of ['paypal', 'shopify', 'fortnox', 'economic']) {
      await expect(
        page.getByTestId(`integration-${provider}`),
      ).not.toHaveAttribute('open', '')
    }
    await expect(
      page.getByText(d.integrationPage.paypalPurpose, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.integrationPage.shopifyPurpose, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.integrationPage.fortnoxPurpose, { exact: true }),
    ).toBeVisible()
    const economic = page.getByTestId('integration-economic')
    await expect(
      economic.getByText('e-conomic', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      economic.getByText(d.economic.intro, { exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByTestId('integration-fortnox')
        .getByText('e-conomic', { exact: true }),
    ).toHaveCount(0)
    await page.screenshot({
      path: 'private/integrations-overview-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 375, height: 812 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/integrations-overview-mobile.png',
      fullPage: true,
    })
    for (const provider of ['paypal', 'shopify', 'fortnox']) {
      const panel = page.getByTestId(`integration-${provider}`)
      await panel.locator(':scope > summary').focus()
      await page.keyboard.press('Enter')
      await expect(panel).toHaveAttribute('open', '')
    }
    await expect(
      page.getByRole('heading', {
        name: d.integrationPage.paypalWorkspace.connection,
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: 'PayPal POS', exact: true })
        .getByText(d.zettle.oauth.hint, { exact: true }),
    ).toBeVisible()
    for (const category of [
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
      page
        .getByTestId('integration-fortnox')
        .getByRole('link', { name: d.integrationPage.accountingSettings }),
    ).toHaveAttribute('href', '/intake/accounting?view=settings')
    expect(await page.locator('main').first().innerText()).not.toContain(
      'Zettle',
    )

    expect(await page.locator('main').first().innerText()).not.toMatch(/pilot/i)
    const paypal = page.getByTestId('integration-paypal')
    await expect(paypal.getByRole('tab')).toHaveCount(3)
    await paypal
      .getByRole('tab', {
        name: d.integrationPage.paypalWorkspace.sales,
        exact: true,
      })
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
    await page.goto('/intake/integrations?provider=economic')
    await expect(economic).toHaveAttribute('open', '')
    await expect(page.getByTestId('integration-fortnox')).not.toHaveAttribute(
      'open',
      '',
    )
    await economic
      .getByRole('link', { name: d.integrationPage.accountingSettings })
      .click()
    await expect(page).toHaveURL(
      /\/intake\/accounting\?view=settings#economic-connection$/,
    )
    await expect(
      page
        .locator('#economic-connection')
        .getByRole('heading', { name: 'e-conomic', exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
