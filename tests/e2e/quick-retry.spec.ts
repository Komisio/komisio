import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('retrying a lost quick-reception response does not register another item', async ({
  page,
}) => {
  const email = `quick-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic retry chair')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('250')
    const requests: Record<string, unknown>[] = []
    let saved:
      { itemId: string; reference: string; sessionId: string } | undefined
    let firstStatus = 0
    await page.route('**/api/intake/quick', async (route) => {
      requests.push(route.request().postDataJSON())
      if (requests.length !== 1) return route.continue()
      const response = await route.fetch()
      firstStatus = response.status()
      saved = await response.json()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    const submit = page.locator('.quick-finish').getByRole('button')
    await submit.click()
    await expect(page.locator('.quick-item').getByRole('alert')).toBeVisible()
    expect(firstStatus).toBe(200)
    await submit.click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toBeVisible()
    const items = (
      await f.db.query('select id,origin_id from items where tenant_id=$1', [
        f.tenant,
      ])
    ).rows
    expect(items).toEqual([{ id: saved!.itemId, origin_id: saved!.sessionId }])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(saved!.reference)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_sessions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='item.quick_received'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
