import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('accounting setup reveals details on demand and preserves deep links', async ({
  page,
}) => {
  const email = `accounting-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const fixture = await p2Fixture(email)
  try {
    await fixture.commit()
    await page.goto('/intake/accounting?view=settings#accounting-systems')
    const provider = page.locator('.accounting-provider-disclosure')
    const map = page.locator('.accounting-map-disclosure')
    await expect(provider).not.toHaveAttribute('open', '')
    await expect(map).not.toHaveAttribute('open', '')
    await expect(
      page.getByText(d.accounting.fileHint, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.accounting.mapIntro, { exact: true }),
    ).not.toBeVisible()
    await page.screenshot({
      path: 'private/accounting-settings-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/accounting-settings-mobile.png',
      fullPage: true,
    })
    await provider.locator(':scope > summary').press('Enter')
    await expect(page.locator('#fortnox-connection')).toBeVisible()
    await expect(page.locator('.fortnox-guide')).not.toHaveAttribute('open', '')
    await page.goto('/intake/accounting?view=settings#account-map')
    await expect(page.locator('#account-map input').first()).toBeVisible()
    await page
      .getByRole('button', { name: d.accounting.setup.mapHelp, exact: true })
      .click()
    await expect(
      page.getByText(d.accounting.mapIntro, { exact: true }),
    ).toBeVisible()
    await page.goto('/intake/accounting?view=settings#fortnox-automation')
    await expect(page.locator('#fortnox-automation')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  } finally {
    await fixture.close()
  }
})
