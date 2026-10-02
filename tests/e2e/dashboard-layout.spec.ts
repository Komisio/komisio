import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('overview prioritizes daily tasks and retains setup links across screen sizes', async ({
  page,
}, testInfo) => {
  const email = `overview-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: d.home, exact: true }),
    ).toBeVisible()
    const actions = page.getByRole('region', { name: d.dashboard.actions })
    await expect(actions.getByRole('link')).toHaveCount(4)
    await expect(
      actions.getByRole('link', { name: new RegExp(d.quickIntake.title) }),
    ).toHaveAttribute('href', '/intake/quick')
    await expect(page.locator('.dashboard-followups a')).toHaveCount(3)
    const setup = page.getByRole('region', { name: d.setupTitle })
    await expect(setup.getByRole('progressbar')).toBeVisible()
    await setup.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(setup.locator('details')).toHaveAttribute('open', '')
    await expect(setup.locator('.steps a')).toHaveCount(11)
    await setup.locator('summary').click()
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`overview-${width}.png`),
        fullPage: true,
      })
    }
    await actions
      .getByRole('link', { name: new RegExp(d.quickIntake.title) })
      .click()
    await expect(page).toHaveURL('/intake/quick')
  } finally {
    await f.close()
  }
})
