import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

test('sidebar overlays dismiss immediately after becoming visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  const email = `sidebar-overlay-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const fixture = await p2Fixture(email)
  try {
    await fixture.commit()
    await page.goto('/intake/items')
    const sidebar = page.locator('.sidebar')
    const toggle = sidebar.locator('.sidebar-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const item = sidebar.locator('a[href="/intake/items"]')
    await item.hover()
    await expect(page.locator('.sidebar-tooltip')).toBeVisible()
    // Do not wait for an effect/timer between rendering and dismissal.
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar-tooltip')).toHaveCount(0)
    await page.mouse.move(600, 400)
    await toggle.focus()
    await item.focus()
    await expect(page.locator('.sidebar-tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar-tooltip')).toHaveCount(0)
    await expect(item).toBeFocused()
    const store = sidebar.locator('button.sidebar-store')
    await store.click()
    await expect(sidebar.locator('.sidebar-flyout')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sidebar.locator('.sidebar-flyout')).not.toBeVisible()
    await expect(store).toBeFocused()
  } finally {
    await fixture.close()
  }
})
