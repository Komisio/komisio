import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('Shopify setup selects POS or both, persists per tenant and locks after sync', async ({
  page,
}) => {
  const email = `shopify-setup-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      'select store_shopify_connection($1,\'synthetic.myshopify.com\',\'Synthetic\',\'SEK\',\'{"iv":"a","tag":"b","data":"c"}\',\'read_orders\',null)',
      [f.tenant],
    )
    await f.commit()
    // Provider discovery is a local fixture; settings still go through the real SQL engine as the identified owner.
    await page.route('**/api/integrations/shopify', async (route) => {
      const body = route.request().postDataJSON()
      if (body.action === 'setupOptions')
        return route.fulfill({
          json: {
            locations: [
              { id: 'gid://shopify/Location/1', name: 'Synthetic shop' },
            ],
            publications: [
              { id: 'gid://shopify/Publication/1', name: 'Online Store' },
              { id: 'gid://shopify/Publication/2', name: 'Point of Sale' },
            ],
          },
        })
      if (body.action === 'saveSettings') {
        expect(body.tenantId).toBe(f.tenant)
        const result = await f.asActor<{ rows: { s: unknown }[] }>(
          f.actor,
          () =>
            f.db.query('select save_shopify_sync_settings($1,$2,$3,$4) s', [
              f.tenant,
              'synthetic.myshopify.com',
              body.revision,
              body.settings,
            ]),
        )
        return route.fulfill({ json: result.rows[0].s })
      }
      return route.continue()
    })
    await page.goto('/intake/integrations')
    const region = page.getByRole('region', {
      name: d.shopify.setup.title,
      exact: true,
    })
    await region
      .getByRole('button', { name: d.shopify.setup.configure })
      .click()
    await region
      .getByRole('radio', { name: d.shopify.setup.modes.pos, exact: true })
      .check()
    await expect(
      region.getByRole('combobox', {
        name: d.shopify.setup.webPublication,
        exact: true,
      }),
    ).toHaveCount(0)
    await region
      .getByRole('combobox', { name: d.shopify.setup.location, exact: true })
      .selectOption('gid://shopify/Location/1')
    await region
      .getByRole('combobox', {
        name: d.shopify.setup.posPublication,
        exact: true,
      })
      .selectOption('gid://shopify/Publication/2')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/shopify-setup-mobile.png',
      fullPage: true,
    })
    await region.getByRole('button', { name: d.shopify.setup.save }).click()
    await expect(
      region.getByText('Shopify POS · Synthetic shop', { exact: true }),
    ).toBeVisible()
    await region
      .getByRole('button', { name: d.shopify.setup.configure })
      .click()
    await region
      .getByRole('radio', { name: d.shopify.setup.modes.both, exact: true })
      .check()
    await region
      .getByRole('combobox', {
        name: d.shopify.setup.webPublication,
        exact: true,
      })
      .selectOption('gid://shopify/Publication/2')
    await expect(
      region.getByRole('button', { name: d.shopify.setup.save }),
    ).toBeDisabled()
    await region
      .getByRole('combobox', {
        name: d.shopify.setup.webPublication,
        exact: true,
      })
      .selectOption('gid://shopify/Publication/1')
    await region.getByRole('button', { name: d.shopify.setup.save }).click()
    await expect(
      region.getByText(`${d.shopify.setup.modes.both} · Synthetic shop`, {
        exact: true,
      }),
    ).toBeVisible()
    await f.asActor(f.actor, () =>
      f.db.query(
        "select record_shopify_order_page($1,$2,shopify_order_cursor($1),shopify_order_cursor($1),'[]')",
        [f.tenant, randomUUID()],
      ),
    )
    await page.reload()
    await expect(
      region.getByText(d.shopify.setup.locked, { exact: true }),
    ).toBeVisible()
    await expect(
      region.getByRole('button', { name: d.shopify.setup.configure }),
    ).toHaveCount(0)
  } finally {
    await f.close()
  }
})
