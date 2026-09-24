import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { seal } from '../../lib/platform/credentials'
import d from '../../messages/sv.json' with { type: 'json' }

test('privacy requests remain pending until an authorized, recorded manual outcome', async ({
  page,
}) => {
  const email = `privacy-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const shop = `privacy-${randomUUID()}.myshopify.com`
    await f.db.query(
      'select store_shopify_connection($1,$2,\'Synthetic\',\'SEK\',\'{"iv":"a","tag":"b","data":"c"}\',\'read_orders\',null)',
      [f.tenant, shop],
    )
    await f.commit()
    // Explicit local-only receiver registration. Production has a separate identity.
    await f.db.query(
      'select komisio_private.register_shopify_privacy_actor($1)',
      [f.actor],
    )
    const payload = {
      shop_id: '42',
      shop_domain: shop,
      customer: { id: '9' },
      orders_to_redact: ['7'],
    }
    const cipher = seal('shopify-privacy', payload, {
      KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
    })
    await f.asActor(f.actor, () =>
      f.db.query(
        "select receive_shopify_privacy('customers/redact',$1,$2,$3)",
        [
          shop,
          createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
          cipher,
        ],
      ),
    )
    await page.goto('/intake/integrations/privacy')
    await expect(
      page.getByRole('heading', { name: d.shopifyPrivacy.title, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(`${shop} · ${d.shopifyPrivacy.statuses.pending}`, {
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole('combobox', { name: d.shopifyPrivacy.outcome })
      .selectOption('retained')
    await page
      .getByLabel(d.shopifyPrivacy.note, { exact: true })
      .fill('Synthetic retention decision awaiting review')
    await page.getByRole('button', { name: d.shopifyPrivacy.save }).click()
    await expect(
      page.getByText(`${shop} · ${d.shopifyPrivacy.statuses.retained}`, {
        exact: true,
      }),
    ).toBeVisible()
    await page.getByText(d.shopifyPrivacy.history, { exact: true }).click()
    await expect(
      page.getByText(/Synthetic retention decision awaiting review/),
    ).toBeVisible()
    const rows = await f.asActor<{
      rows: { q: { status: string; history: unknown[] }[] }[]
    }>(f.actor, () =>
      f.db.query('select shopify_privacy_queue($1) q', [f.tenant]),
    )
    expect(rows.rows[0].q[0].history).toHaveLength(1)
    expect(rows.rows[0].q[0].status).toBe('retained')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

test('public privacy endpoints reject bad signatures and never acknowledge unavailable storage', async ({
  request,
}) => {
  const raw = JSON.stringify({
    shop_id: 42,
    shop_domain: 'synthetic.myshopify.com',
  })
  const url = '/api/integrations/shopify/privacy/shop-redact'
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Topic': 'shop/redact',
    'X-Shopify-Shop-Domain': 'synthetic.myshopify.com',
    'X-Shopify-Webhook-Id': randomUUID(),
  }
  expect((await request.post(url, { data: raw, headers })).status()).toBe(401)
  const signature = createHmac('sha256', 'synthetic-shopify-privacy-secret')
    .update(raw)
    .digest('base64')
  const valid = await request.post(url, {
    data: raw,
    headers: { ...headers, 'X-Shopify-Hmac-Sha256': signature },
  })
  expect(valid.status()).toBe(503)
  expect(await valid.json()).toEqual({ received: false })
  expect(
    (
      await request.post('/api/integrations/shopify/privacy', {
        data: {},
        headers: { Origin: 'https://wrong.example.test' },
      })
    ).status(),
  ).toBe(403)
})
