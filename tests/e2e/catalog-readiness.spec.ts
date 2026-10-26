import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('missing VAT configuration explains a blocked export and recovers after owner configuration', async ({
  page,
}) => {
  const email = `catalog-readiness-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy')-'vatModeStoreOwned')",
      [f.tenant, randomUUID()],
    )
    const purchase = (
      await f.db.query(
        "select register_purchase($1,$2,'Synthetic purchase',15000,'Test receipt',false) id",
        [f.tenant, randomUUID()],
      )
    ).rows[0].id
    const item = randomUUID()
    await f.db.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
      f.tenant,
      item,
      purchase,
    ])
    await f.db.query('select enable_zettle_pull($1,$2)', [
      f.tenant,
      randomUUID(),
    ])
    await f.commit()
    const requests: string[] = []
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/integrations/zettle')
      )
        requests.push(request.url())
    })
    await page.goto(`/intake/items/${item}#sync-status`)
    const panel = page.locator('.item-sync-connection').filter({
      has: page.getByRole('heading', { name: 'PayPal POS', exact: true }),
    })
    await expect(panel.locator('.item-sync-state')).toHaveText(
      d.itemSync.states.attention,
    )
    await panel.getByText(d.itemSync.details, { exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText(
      d.zettle.errors.VAT_MODE_NOT_SET,
    )
    await expect(
      panel.getByRole('button', {
        name: d.zettle.itemSync.syncNow,
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(
      panel.getByRole('link', { name: d.itemSync.settings, exact: true }),
    ).toBeVisible()
    await f.asActor(f.actor, () =>
      f.db.query(
        "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy')||'{\"vatModeStoreOwned\":\"store_full\"}')",
        [f.tenant, randomUUID()],
      ),
    )
    await page.reload()
    await panel.getByText(d.itemSync.details, { exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText(
      d.zettle.errors.ZETTLE_VAT_MAPPING_REQUIRED,
    )
    await expect(
      panel.getByRole('button', {
        name: d.zettle.itemSync.syncNow,
        exact: true,
      }),
    ).toHaveCount(0)
    await f.asActor(f.actor, () =>
      f.db.query(
        'select publish_zettle_catalog_config($1,$2,null,\'{"store_full":25}\')',
        [f.tenant, randomUUID()],
      ),
    )
    await page.reload()
    await expect(panel.locator('.item-sync-state')).toHaveText(
      d.itemSync.states.not_sent,
    )
    await expect(
      panel.getByRole('button', {
        name: d.zettle.itemSync.syncNow,
        exact: true,
      }),
    ).toBeVisible()
    expect(requests).toEqual([])
  } finally {
    await f.close()
  }
})
