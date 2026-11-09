import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('owner saves the future external app preference independently of photo pre-review', async ({
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
    await expect(checkbox).not.toBeChecked()
    await expect(photos).toBeChecked()
    await expect(checkbox).toHaveAccessibleDescription(
      d.storePolicy.editor.externalAppSubmissionsHelp,
    )
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(checkbox).toBeVisible()
      const bounds = (await checkbox.boundingBox())!
      expect(bounds.width).toBeLessThanOrEqual(24)
      expect(bounds.height).toBeLessThanOrEqual(24)
      await page.locator('#policy-section-receiving').screenshot({
        path: `private/external-app-setting-${width}.png`,
      })
    }
    for (const enabled of [true, false]) {
      await checkbox.setChecked(enabled)
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
        externalAppSubmissionsEnabled: enabled,
        photoSubmissionsEnabled: true,
      })
      await page.reload()
      await expect(checkbox).toBeChecked({ checked: enabled })
      await expect(photos).toBeChecked()
    }
  } finally {
    await f.close()
  }
})
