import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import type { PosProduct } from '../../lib/pos-import'

test('POS review handles paging, 300 sellers, uncertain imports and existing item links', async ({
  page,
}, info) => {
  const email = `pos-import-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const merchant = randomUUID(),
    shop = 'synthetic.myshopify.com'
  const existing = await f.item('Existing synthetic coat')
  await f.db.query(
    "select register_seller($1,gen_random_uuid(),'Directory seller '||n,'directory-'||n||'@example.test','') from generate_series(1,300) n",
    [f.tenant],
  )
  await f.db.query(
    `select store_paypal_oauth($1,$2,'{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',now()+interval '1 hour',0)`,
    [f.tenant, merchant],
  )
  await f.db.query(
    `select store_shopify_connection($1,$2,'Synthetic','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}','read_products',null)`,
    [f.tenant, shop],
  )
  await f.commit()
  const products: PosProduct[] = Array.from({ length: 55 }, (_, i) => ({
    productId: randomUUID(),
    variantId: randomUUID(),
    title: `Synthetic product ${String(i).padStart(2, '0')}`,
    sku: `OLD-${i}`,
    barcode: `001234${i}`,
    priceOre: 20000,
    currency: 'SEK',
    quantity: null,
    active: true,
  }))
  const shopProduct = {
    ...products[0],
    productId: 'gid://shopify/Product/1',
    variantId: 'gid://shopify/ProductVariant/1',
    title: 'Existing synthetic coat',
    quantity: 1,
  }
  let lost = true
  const commits: Record<string, unknown>[] = []
  // Provider reads are synthetic. Each review command uses the real loopback engine.
  await page.route('**/api/import/pos', async (route) => {
    const c = route.request().postDataJSON()
    let data: unknown
    if (c.action === 'list') {
      const batch =
        c.provider === 'shopify'
          ? [shopProduct]
          : c.cursor
            ? products.slice(30)
            : products.slice(0, 30)
      data = {
        account: c.provider === 'shopify' ? shop : merchant,
        next: c.provider === 'paypal' && !c.cursor ? '30' : null,
        rows: batch.map((p) => ({
          product: p,
          token: p.variantId,
          linked: null,
          suggestions: [],
        })),
      }
    } else if (c.action === 'prepare') {
      data = await f.asActor(f.actor, async () => ({
        context: (
          await f.db.query('select inventory_import_context($1,$2) context', [
            f.tenant,
            [c.sellerId],
          ])
        ).rows[0].context,
      }))
    } else if (c.action === 'search') {
      data = await f.asActor(f.actor, async () => ({
        items: (
          await f.db.query('select pos_import_search($1,$2) items', [
            f.tenant,
            c.query,
          ])
        ).rows[0].items,
      }))
    } else {
      commits.push(c)
      const product =
        c.token === shopProduct.variantId
          ? shopProduct
          : products.find((p) => p.variantId === c.token)!
      data = await f.asActor(
        f.actor,
        async () =>
          (
            await f.db.query(
              'select commit_pos_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',
              [
                f.tenant,
                c.requestId,
                product === shopProduct ? 'shopify' : 'paypal',
                product === shopProduct ? shop : merchant,
                product,
                c.mode,
                c.itemId,
                c.sellerId,
                c.context,
                c.received,
              ],
            )
          ).rows[0].result,
      )
      if (lost) {
        lost = false
        await route.abort('failed')
        return
      }
    }
    await route.fulfill({ json: data })
  })
  try {
    await page.goto('/intake/import/pos')
    await expect(page).toHaveURL(/\/intake\/import\/items#item-import-pos$/)
    await expect(
      page.getByRole('heading', { name: d.inventoryImport.title, exact: true }),
    ).toBeVisible()
    await expect(
      page.locator('.sidebar-nav a[href="/intake/import/pos"]'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('tab', { name: d.inventoryImport.fromPos }),
    ).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('button', { name: d.posImport.load, exact: true })
      .click()
    await expect(page.locator('.pos-import-table tbody > tr')).toHaveCount(25)
    await page
      .getByRole('button', { name: d.posImport.next, exact: true })
      .click()
    await expect(
      page.getByText('Synthetic product 29', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: d.posImport.loadMore, exact: true })
      .click()
    await expect(
      page.getByText(d.posImport.count.replace('{count}', '55'), {
        exact: true,
      }),
    ).toBeVisible()
    await page.locator('#pos-search').fill('Synthetic product 00')
    await page.getByRole('tab', { name: d.inventoryImport.fromFile }).click()
    await expect(
      page.getByRole('button', { name: d.inventoryImport.choose, exact: true }),
    ).toBeVisible()
    await page.getByRole('tab', { name: d.inventoryImport.fromPos }).click()
    await expect(page.locator('#pos-search')).toHaveValue(
      'Synthetic product 00',
    )
    await page
      .getByRole('button', { name: d.posImport.review, exact: true })
      .click()
    await expect(
      page.getByText(
        d.quickIntake.workspace.searchAmong.replace('{count}', '301'),
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.posImport.import, exact: true }),
    ).toBeDisabled()
    await page.locator('#quick-seller-search').fill('Synthetic P2 seller')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page.getByRole('checkbox', { name: d.posImport.custody }).check()
    await expect(
      page.getByRole('button', { name: d.posImport.import, exact: true }),
    ).toBeEnabled()
    await page.screenshot({
      path: info.outputPath('pos-review-desktop.png'),
      fullPage: true,
    })
    await page
      .getByRole('button', { name: d.posImport.import, exact: true })
      .click()
    await expect(
      page.getByText(d.posImport.retryInfo, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.posImport.close, exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: d.posImport.review, exact: true }),
    ).toBeDisabled()
    await page.getByRole('tab', { name: d.inventoryImport.fromFile }).click()
    await page.getByRole('tab', { name: d.inventoryImport.fromPos }).click()
    await expect(
      page.getByText(d.posImport.retryInfo, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: d.posImport.retry, exact: true })
      .click()
    expect(commits[0]).toEqual(commits[1])
    await expect(page.locator('.pos-import > p[role="status"]')).toContainText(
      'Synthetic product 00',
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
    await page.locator('#pos-search').fill('')
    await page.locator('#pos-provider').selectOption('shopify')
    await page
      .getByRole('button', { name: d.posImport.load, exact: true })
      .click()
    await page
      .getByRole('button', { name: d.posImport.review, exact: true })
      .click()
    await page
      .getByRole('radio', { name: d.posImport.link, exact: true })
      .check()
    await page
      .getByPlaceholder(d.posImport.findItem)
      .fill('Existing synthetic coat')
    await page
      .getByRole('button', { name: d.posImport.searchButton, exact: true })
      .click()
    await page.getByRole('radio', { name: /Existing synthetic coat/ }).check()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390)
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
    await page.screenshot({
      path: info.outputPath('pos-review-mobile.png'),
      fullPage: true,
    })
    await page
      .getByRole('button', { name: d.posImport.saveLink, exact: true })
      .click()
    await expect(page.locator('.pos-import > p[role="status"]')).toContainText(
      'Existing synthetic coat',
    )
    expect(
      (
        await f.db.query(
          "select item_id from pos_product_links where tenant_id=$1 and provider='shopify'",
          [f.tenant],
        )
      ).rows[0].item_id,
    ).toBe(existing)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
    await page.unroute('**/api/import/pos')
    const forbidden = await page.request.post('/api/import/pos', {
      headers: { origin: 'https://wrong.example.test' },
      data: { action: 'search', tenantId: f.tenant, query: 'coat' },
    })
    expect(forbidden.status()).toBe(403)
  } finally {
    await f.db.end()
  }
})
