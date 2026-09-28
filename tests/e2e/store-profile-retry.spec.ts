import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const reply of ['lost', 'wrong-id', 'validation-5xx'] as const)
  test(`an unconfirmed store profile reply (${reply}) retries the same version`, async ({
    page,
  }) => {
    const email = `store-profile-retry-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 720 })
      await page.goto('/settings?tab=profile')
      const region = page.getByRole('region', {
        name: d.storeProfile.title,
        exact: true,
      })
      const city = region.locator('#profile-city')
      await city.fill('Synthetic retry city')
      const requests: Record<string, unknown>[] = []
      let committedId = ''
      let firstStatus = 0
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        if (command?.action !== 'publishStoreProfile') return route.continue()
        requests.push(command)
        if (requests.length === 1) {
          const response = await route.fetch()
          firstStatus = response.status()
          committedId = (await response.json()).id
          await route.fulfill({
            status: reply === 'wrong-id' ? 200 : 503,
            contentType: 'application/json',
            body: JSON.stringify(
              reply === 'wrong-id'
                ? { ok: true, id: randomUUID() }
                : {
                    error:
                      reply === 'validation-5xx'
                        ? 'INVALID_INPUT'
                        : 'REQUEST_FAILED',
                  },
            ),
          })
        } else await route.continue()
      })
      await region
        .getByRole('button', { name: d.storeProfile.publish, exact: true })
        .click()
      await expect(region.getByRole('alert')).toHaveText(d.intake.failed)
      expect(firstStatus).toBe(200)
      expect(committedId).toBe(requests[0].requestId)
      await expect(city).toBeDisabled()
      await region
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect.poll(() => requests.length).toBe(2)
      expect(requests[1]).toEqual(requests[0])
      await expect(region).toContainText(`${d.storeProfile.version} 1`)
      await expect(city).toHaveValue('Synthetic retry city')
      await expect(city).toBeEnabled()
      expect(
        (
          await f.db.query(
            'select id,version,profile from store_profile_versions where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([{ id: committedId, version: 1, profile: requests[0].profile }])
    } finally {
      await f.close()
    }
  })
