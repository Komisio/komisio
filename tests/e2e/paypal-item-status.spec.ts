import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('Independent connection status filters the full inventory and opens a scoped retry from item details', async ({
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
    await f.db.query('reset role')
    await f.db.query(
      `insert into shopify_connections(tenant_id,shop_domain,shop_name,currency,cipher,connected_by)
      values($1,'synthetic.myshopify.com','Synthetic','SEK','{"iv":"test","tag":"test","data":"test"}',auth.uid())`,
      [f.tenant],
    )
    await f.db.query('set local role authenticated')
    const shopifyJob = (
      await f.db.query('select prepare_shopify_product($1,$2) id', [
        f.tenant,
        ids[56],
      ])
    ).rows[0].id
    await f.db.query(
      "select finish_shopify_product($1,$2,'synced',null,'gid://shopify/Product/1','gid://shopify/ProductVariant/1','gid://shopify/InventoryItem/1')",
      [f.tenant, shopifyJob],
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
    await page
      .getByLabel(d.itemSync.title, { exact: true })
      .selectOption('failed')
    await page
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .last()
      .click()
    await expect(page.locator('.inventory-row')).toHaveCount(1)
    await expect(page.locator('.inventory-row')).toContainText('POS jacket 56')
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page
      .getByRole('link', {
        name: `PayPal POS · ${d.itemSync.states.failed}`,
        exact: true,
      })
      .click()
    const section = page.getByRole('region', {
      name: d.itemSync.title,
      exact: true,
    })
    const panel = section.locator('.item-sync-connection').filter({
      has: page.getByRole('heading', { name: 'PayPal POS', exact: true }),
    })
    const shopifyPanel = section.locator('.item-sync-connection').filter({
      has: page.getByRole('heading', { name: 'Shopify', exact: true }),
    })
    await expect(shopifyPanel).toContainText(d.itemSync.states.synced)
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
    await page.route('**/api/integrations/shopify', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        tenantId: f.tenant,
        itemId: ids[56],
        action: 'exportItem',
      })
      await route.fulfill({
        status: 409,
        json: { error: 'SHOPIFY_OUTCOME_UNKNOWN' },
      })
    })
    await shopifyPanel
      .getByRole('button', { name: d.itemSync.syncNow, exact: true })
      .click()
    await expect(shopifyPanel.getByRole('alert')).toContainText(
      d.shopify.errors.SHOPIFY_OUTCOME_UNKNOWN,
    )
    await expect(panel.getByRole('alert')).toContainText(
      d.zettle.errors.ZETTLE_UPDATE_FAILED,
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/item-sync-mobile.png',
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
