import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('new seller navigation focuses the name without resetting typed fields', async ({
  page,
}) => {
  const email = `seller-focus-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake')
    const name = page.getByRole('textbox', { name: d.intake.name, exact: true })
    await expect(name).not.toBeVisible()
    const disclosure = page.locator('.intake-registration > summary')
    await expect(disclosure).toHaveText(d.intake.newSeller)
    await disclosure.click()
    await expect(name).toBeFocused()
    await expect(name).toBeInViewport()
    await page.keyboard.type('Synthetic new seller')
    await page
      .getByLabel(d.intake.email, { exact: true })
      .fill('new@example.test')
    await expect(name).not.toBeFocused()
    await disclosure.click()
    await expect(name).not.toBeVisible()
    await disclosure.focus()
    await page.keyboard.press('Enter')
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('Synthetic new seller')
    await page.goto('/intake/quick')
    await page
      .getByRole('button', { name: d.quickIntake.newSeller, exact: true })
      .click()
    await expect(name).toBeFocused()
    await expect(name).toBeInViewport()
    await page.goto('/intake/quick')
    await page.goto('/intake#new-seller')
    await expect(name).toBeFocused()
    await page.goto(`/intake?seller=${f.seller}`)
    await page.locator('.intake-find-seller > summary').click()
    await page
      .getByRole('link', { name: d.intake.newSeller, exact: true })
      .click()
    await expect(page).toHaveURL('/intake#new-seller')
    await expect(name).toBeFocused()
    await expect(disclosure).toHaveCount(1)
  } finally {
    await f.close()
  }
})
