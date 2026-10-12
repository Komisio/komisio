import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('connection image preferences stay independent and a lost save replays once', async ({
  page,
}) => {
  const email = `sync-settings-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const merchant = randomUUID()
  const item = await f.item('Synthetic image race item')
  const photo = randomUUID()
  try {
    await f.db.query('select enable_zettle_pull($1,$2)', [f.tenant, merchant])
    await f.db.query('select publish_zettle_catalog_config($1,$2,null,$3)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({ consignment_margin: 0 }),
    ])
    await f.db.query('reset role')
    await f.db.query(
      `insert into shopify_connections(tenant_id,shop_domain,shop_name,currency,cipher,connected_by)
      values($1,'synthetic.myshopify.com','Synthetic','SEK','{"iv":"test","tag":"test","data":"test"}',$2)`,
      [f.tenant, f.actor],
    )
    await f.db.query(
      "insert into storage.objects(bucket_id,name) values('item-photos',$1)",
      [`${f.tenant}/${item}/${photo}.jpg`],
    )
    await f.db.query('set local role authenticated')
    await f.db.query("select change_item_photo($1,$2,$3,0,'add',$4)", [
      f.tenant,
      randomUUID(),
      item,
      photo,
    ])
    await f.db.query(
      "select finish_zettle_product($1,prepare_zettle_product($1,$2),'synced',null)",
      [f.tenant, item],
    )
    await f.commit()
    await page.goto('/intake/integrations?provider=paypal')
    const paypal = page.getByRole('region', {
      name: `PayPal POS · ${d.itemSync.preferences.title}`,
      exact: true,
    })
    await expect(
      paypal.getByRole('checkbox', {
        name: d.itemSync.preferences.images,
        exact: true,
      }),
    ).not.toBeChecked()
    const requests: string[] = []
    await page.route('**/api/integrations/sync-settings', async (route) => {
      const body = route.request().postDataJSON()
      expect(body).toMatchObject({
        tenantId: f.tenant,
        provider: 'paypal',
        connectionId: merchant,
        images: true,
      })
      requests.push(body.requestId)
      const response = await route.fetch()
      if (requests.length === 1) await route.abort('connectionreset')
      else await route.fulfill({ response })
    })
    await paypal
      .getByRole('checkbox', {
        name: d.itemSync.preferences.images,
        exact: true,
      })
      .check()
    await paypal
      .getByRole('button', { name: d.itemSync.preferences.save, exact: true })
      .click()
    await expect(paypal.getByRole('alert')).toHaveText(
      d.itemSync.preferences.uncertain,
    )
    await expect(
      paypal.getByRole('checkbox', {
        name: d.itemSync.preferences.images,
        exact: true,
      }),
    ).toBeDisabled()
    await paypal
      .getByRole('button', { name: d.itemSync.retry, exact: true })
      .click()
    await expect(
      paypal
        .getByRole('status')
        .filter({ hasText: d.itemSync.preferences.saved }),
    ).toHaveText(d.itemSync.preferences.saved)
    expect(requests).toHaveLength(2)
    expect(requests[0]).toBe(requests[1])
    const rows = await f.db.query(
      'select provider,images from integration_sync_preference_revisions where tenant_id=$1',
      [f.tenant],
    )
    expect(rows.rows).toEqual([{ provider: 'paypal', images: true }])
    await page.unroute('**/api/integrations/sync-settings')
    await page.goto('/intake/integrations?provider=shopify')
    const shopify = page.getByRole('region', {
      name: `Shopify · ${d.itemSync.preferences.title}`,
      exact: true,
    })
    await expect(shopify.getByRole('checkbox')).not.toBeChecked()
    await shopify.getByRole('checkbox').check()
    await shopify
      .getByRole('button', { name: d.itemSync.preferences.save, exact: true })
      .click()
    await expect(shopify.getByRole('status')).toHaveText(
      d.itemSync.preferences.saved,
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(shopify).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await shopify.screenshot({ path: 'private/sync-settings-mobile.png' })

    // Two independent sessions compete against one revision. The tenant lock
    // makes the loser re-read committed state instead of overwriting it.
    const { Client } = createRequire(import.meta.url)('pg')
    const other = new Client({
      connectionString:
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
    await other.connect()
    try {
      await f.db.query('begin')
      await f.db.query('set local role authenticated')
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: f.actor, role: 'authenticated' }),
      ])
      await f.db.query(
        'select save_integration_sync_preference($1,$2,$3,$4,$5,false)',
        [f.tenant, randomUUID(), 'paypal', merchant, requests[0]],
      )
      await other.query('begin')
      await other.query('set local role authenticated')
      await other.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: f.actor, role: 'authenticated' }),
      ])
      const competing = other
        .query('select save_integration_sync_preference($1,$2,$3,$4,$5,true)', [
          f.tenant,
          randomUUID(),
          'paypal',
          merchant,
          requests[0],
        ])
        .catch((error: Error) => error)
      await f.db.query('commit')
      expect((await competing).message).toContain('SYNC_SETTINGS_CHANGED')
      await other.query('rollback')
      await f.db.query('begin')
      await f.db.query('set local role authenticated')
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: f.actor, role: 'authenticated' }),
      ])
      const first = (
        await f.db.query('select prepare_zettle_image($1,$2,$3,$4) claim', [
          f.tenant,
          randomUUID(),
          item,
          merchant,
        ])
      ).rows[0].claim
      await other.query('begin')
      await other.query('set local role authenticated')
      await other.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: f.actor, role: 'authenticated' }),
      ])
      const nextClaim = other.query(
        'select prepare_zettle_image($1,$2,$3,$4) claim',
        [f.tenant, randomUUID(), item, merchant],
      )
      await f.db.query('commit')
      const second = (await nextClaim).rows[0].claim
      expect(first.fresh).toBe(true)
      expect(second.fresh).toBe(false)
      expect(first.id).toBe(second.id)
    } finally {
      await other.query('rollback')
      await other.end()
    }
  } finally {
    await f.close()
  }
})
