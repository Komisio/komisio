import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'

for (const width of [320, 1280])
  test(`store selection waits for its handler at ${width}px`, async ({
    page,
  }) => {
    const email = `store-ready-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    let release!: () => void
    const scripts = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const other = (
        await f.db.query('select create_tenant($1,$2,$3) id', [
          'Synthetic other store',
          `ready-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      await f.db.query('select set_active_tenant($1)', [f.tenant])
      await f.commit()
      await page.setViewportSize({ width, height: 800 })
      await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
        await scripts
        await route.continue()
      })
      await page.goto('/intake/purchases', { waitUntil: 'commit' })
      const picker = page
        .locator(width === 320 ? '.mobile-picker' : '.sidebar select')
        .first()
      await expect(picker).toBeVisible()
      await expect(picker).toBeDisabled()
      await expect(picker).toHaveValue(f.tenant)
      await picker.focus()
      await expect(picker).not.toBeFocused()
      release()
      await expect(picker).toBeEnabled()
      await expect(picker).toHaveValue(f.tenant)
      const changed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/platform') &&
          response.request().method() === 'POST',
      )
      await picker.selectOption(other)
      const response = await changed
      expect(response.status()).toBe(200)
      expect(response.request().postDataJSON()).toMatchObject({
        action: 'select',
        tenantId: other,
      })
      await expect(page).toHaveURL('/')
      await expect(picker).toHaveValue(other)
      await page.reload()
      await expect(picker).toHaveValue(other)
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
      await f.close()
    }
  })
