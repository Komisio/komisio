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
      page.getByRole('heading', { name: 'Zettle', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.zettle.connectionConfigHint, { exact: true }),
    ).toBeVisible()
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
      .getByText(`Zettle · ${d.integrationPage.manage}`, { exact: true })
      .click()
    await expect(page.getByText(d.zettle.recent, { exact: true })).toBeVisible()
  } finally {
    await f.close()
  }
})
