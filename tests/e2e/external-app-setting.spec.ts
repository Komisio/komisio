import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('photo pre-review remains compact and editable without a central intake checkbox', async ({
  page,
}) => {
  const email = `external-app-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings')
    const checkbox = page.getByRole('checkbox', {
      name: d.storePolicy.editor.externalAppSubmissions,
      exact: true,
    })
    const photos = page.getByRole('checkbox', {
      name: d.submissions.enablePhotos,
      exact: true,
    })
    await expect(checkbox).toHaveCount(0)
    await expect(photos).toBeChecked()
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(photos).toBeVisible()
      const bounds = (await photos.boundingBox())!
      expect(bounds.width).toBeLessThanOrEqual(24)
      expect(bounds.height).toBeLessThanOrEqual(24)
      await page.locator('#policy-section-receiving').screenshot({
        path: `private/external-app-setting-${width}.png`,
      })
    }
    for (const enabled of [false, true]) {
      await photos.setChecked(enabled)
      await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake') &&
          r.request().postDataJSON()?.action === 'publishStorePolicy',
      )
      await page
        .getByRole('button', { name: d.storePolicy.publish, exact: true })
        .click()
      const response = await saved
      expect(response.status()).toBe(200)
      expect(response.request().postDataJSON().policy).toMatchObject({
        photoSubmissionsEnabled: enabled,
      })
      await page.reload()
      await expect(checkbox).toHaveCount(0)
      await expect(photos).toBeChecked({ checked: enabled })
    }
  } finally {
    await f.close()
  }
})
