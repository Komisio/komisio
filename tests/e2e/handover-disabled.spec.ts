import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('disabled empty handovers stay compact and link owners to the exact setting', async ({
  page,
}) => {
  const email = `compact-handover-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/handovers')
    await expect(
      page.getByText(d.handovers.disabled, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByLabel(d.handovers.search, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(d.handovers.empty, { exact: true }),
    ).toHaveCount(0)
    const settings = page.getByRole('link', {
      name: d.handovers.settings,
      exact: true,
    })
    await expect(settings).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('disabled-handovers-mobile.png'),
      caret: 'initial',
    })
    await settings.click()
    await expect(page).toHaveURL(/\/settings#policy-custodySources$/)
    await expect(page.locator('#policy-custodySources')).toBeInViewport()
    await expect(
      page.locator('input[name="custodySources"][value="seller_dropoff"]'),
    ).not.toBeChecked()
  } finally {
    await f.close()
  }
})
