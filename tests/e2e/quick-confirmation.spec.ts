import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('a lost reply replays the accepted price and currency after a policy currency change', async ({
  page,
}) => {
  const email = `quick-confirmation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic frozen-price lamp')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('120,50')
    const requests: unknown[] = []
    await page.route('**/api/intake/quick', async (route) => {
      requests.push(route.request().postDataJSON())
      if (requests.length > 1) return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      expect((await response.json()).price).toEqual({
        amount: '120.50',
        currency: 'SEK',
      })
      await route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
    })
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.uncertain,
    )
    await f.asActor(f.actor, () =>
      f.db.query(
        "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || $3::jsonb)",
        [f.tenant, randomUUID(), JSON.stringify({ currency: 'NOK' })],
      ),
    )
    await page
      .getByRole('button', { name: d.quickIntake.retry, exact: true })
      .click()
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    await expect(done.locator('.quick-confirmation-details')).toContainText(
      '120,50',
    )
    await expect(done.locator('.quick-confirmation-details')).toContainText(
      'SEK',
    )
    await expect(done).not.toContainText('NOK')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('confirmed acceptance without readable price stays confirmed and links to the item', async ({
  page,
}) => {
  const email = `quick-confirmation-read-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic confirmed lamp')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('110')
    let requests = 0
    let item = ''
    await page.route('**/api/intake/quick', async (route) => {
      requests++
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      const body = await response.json()
      item = body.itemId
      delete body.price
      await route.fulfill({ response, json: body })
    })
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    await expect(done).toContainText(d.quickIntake.savedPriceUnavailable)
    await expect(done).toContainText('Synthetic confirmed lamp')
    await expect(
      page.getByRole('button', { name: d.quickIntake.retry, exact: true }),
    ).toHaveCount(0)
    await done
      .getByRole('link', { name: d.quickIntake.openItem, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`/intake/items/${item}$`))
    expect(requests).toBe(1)
  } finally {
    await f.close()
  }
})
