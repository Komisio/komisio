import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

test('sidebar preserves visible keyboard focus and dismisses detached overlays', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  const email = `sidebar-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const fixture = await p2Fixture(email)
  try {
    await fixture.commit()
    await page.goto('/intake/items')
    const sidebar = page.locator('.sidebar')
    const toggle = sidebar.locator('.sidebar-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect
      .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
      .toBe(72)

    const itemLink = sidebar.locator('a[href="/intake/items"]')
    await itemLink.hover()
    await expect(page.locator('.sidebar-tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar-tooltip')).toHaveCount(0)
    await page.mouse.move(600, 400)
    await toggle.focus()
    await itemLink.focus()
    await expect(page.locator('.sidebar-tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar-tooltip')).toHaveCount(0)
    await expect(itemLink).toBeFocused()

    // Backward tabbing used to scroll links under the sticky logo/toggle.
    // Exercise both widths and every navigation link, not a static CSS contract.
    for (const collapsed of [true, false]) {
      if (!collapsed) {
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      }
      await sidebar.locator('.sidebar-logout').focus()
      const count = await sidebar.locator('.nav-link').count()
      let checked = 0
      for (let i = 0; i < count + 2; i++) {
        await page.keyboard.press('Shift+Tab')
        if (!(await page.locator('.sidebar .nav-link:focus').count())) continue
        checked++
        await expect
          .poll(() =>
            page.evaluate(() => {
              const link = document.activeElement!
              const header = document.querySelector('.sidebar-header')!
              return (
                link.getBoundingClientRect().top >=
                header.getBoundingClientRect().bottom
              )
            }),
          )
          .toBe(true)
      }
      expect(checked).toBe(count)
    }

    await toggle.click()
    const store = sidebar.locator('.sidebar-store')
    const popup = sidebar.locator('.sidebar-flyout')
    await store.click()
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup).not.toBeVisible()
    await expect(store).toBeFocused()
    await store.click()
    await expect(popup).toBeVisible()
    await sidebar.evaluate((el) => {
      el.scrollTop += 200
    })
    await expect(popup).not.toBeVisible()
    await store.click()
    await expect(popup).toBeVisible()
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(popup).not.toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(sidebar).not.toBeVisible()
    await expect(page.locator('.mobile-nav')).toBeVisible()
  } finally {
    await fixture.close()
  }
})
