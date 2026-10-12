import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('POS status filters the full inventory and opens a scoped retry from item details', async ({
  page,
}) => {
  test.setTimeout(180000)
  const email = `paypal-status-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids: string[] = []
    for (let n = 0; n < 57; n++)
      ids.push(await f.item(`POS jacket ${String(n).padStart(2, '0')}`))
    const config = randomUUID(),
      merchant = randomUUID()
    await f.db.query('select publish_zettle_catalog_config($1,$2,null,$3)', [
      f.tenant,
      config,
      JSON.stringify({ consignment_margin: 0, store_full: 25 }),
    ])
    await f.db.query('select enable_zettle_pull($1,$2)', [f.tenant, merchant])
    const job = (
      await f.db.query('select prepare_zettle_product($1,$2) id', [
        f.tenant,
        ids[56],
      ])
    ).rows[0].id
    await f.db.query(
      "select finish_zettle_product($1,$2,'failed','ZETTLE_UPDATE_FAILED')",
      [f.tenant, job],
    )
    await f.commit()
    await page.goto('/intake/items?sort=title&direction=asc&paypal=not_sent')
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(25)
    await expect(page.locator('.inventory-row').first()).toContainText(
      'POS jacket 25',
    )
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(6)
    await page.getByLabel('PayPal POS', { exact: true }).selectOption('failed')
    await page
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .last()
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(1)
    await expect(page.locator('.inventory-row')).toContainText('POS jacket 56')
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page
      .getByRole('link', { name: d.zettle.itemSync.states.failed, exact: true })
      .click()
    const panel = page.getByRole('region', { name: 'PayPal POS', exact: true })
    await expect(panel).toContainText(d.zettle.errors.ZETTLE_UPDATE_FAILED)
    const requests: string[] = []
    await page.route('**/api/integrations/zettle', async (route) => {
      const body = route.request().postDataJSON()
      expect(body).toMatchObject({
        tenantId: f.tenant,
        itemId: ids[56],
        action: 'export',
      })
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
      requests.push(body.requestId)
      await route.fulfill({
        status: 409,
        json: { error: 'ZETTLE_UPDATE_FAILED' },
      })
    })
    await panel
      .getByRole('button', { name: d.zettle.itemSync.syncNow, exact: true })
      .click()
    await expect(panel.getByRole('alert')).toContainText(
      d.zettle.errors.ZETTLE_UPDATE_FAILED,
    )
    await panel
      .getByRole('button', { name: d.zettle.itemSync.retry, exact: true })
      .click()
    await expect(panel.getByRole('alert')).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toBe(requests[0])
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/paypal-item-mobile.png',
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
