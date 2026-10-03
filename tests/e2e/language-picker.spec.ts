import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

test('language choices support pointer selection, outside dismissal and keyboard escape', async ({
  page,
}) => {
  const email = `language-menu-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=profile')
    const picker = page.locator('.language-picker:visible').first()
    const summary = picker.locator('summary')
    await summary.click()
    await picker.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
    await expect(summary).toContainText('English')
    await expect(picker).not.toHaveAttribute('open')

    await summary.click()
    await page.locator('main h1').click()
    await expect(picker).not.toHaveAttribute('open')

    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(picker).toHaveAttribute('open')
    await page.keyboard.press('Tab')
    await expect(picker.getByRole('button').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(picker).not.toHaveAttribute('open')
    await expect(summary).toBeFocused()

    await page.keyboard.press('Enter')
    await picker.getByRole('button').last().focus()
    await page.keyboard.press('Tab')
    await expect(picker).not.toHaveAttribute('open')
  } finally {
    await f.close()
  }
})
