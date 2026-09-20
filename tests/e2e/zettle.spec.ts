import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('Zettle product export, price update, checkout, automatic credit and concurrent replay', async ({
  page,
}) => {
  test.setTimeout(180000)
  const email = `zettle-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item1 = await f.item('Zettle jacket'),
      item2 = await f.item('Zettle bag')
    await f.commit()
    await page.goto('/intake/integrations')
    await page
      .getByText(`Zettle · ${d.integrationPage.manage}`, { exact: true })
      .click()
    await expect(page.getByText(d.zettle.fixture)).toBeVisible()
    await expect(
      page.getByText(d.zettle.connectionTenantMissing, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.zettle.connectionConfigHint, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.zettle.checkConnection, exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.zettle.pullEnable, exact: true }),
    ).toHaveCount(0)
    for (const action of ['enablePull', 'pull', 'export', 'exportImage']) {
      const denied = await page.request.post('/api/integrations/zettle', {
        headers: { origin: 'http://127.0.0.1:3000' },
        data: {
          action,
          tenantId: f.tenant,
          requestId: randomUUID(),
          ...(['export', 'exportImage'].includes(action)
            ? { itemId: item1 }
            : {}),
        },
      })
      expect(denied.status()).toBe(409)
      expect(await denied.json()).toEqual({ error: 'ZETTLE_NOT_CONNECTED' })
    }
    const connectionPath = '/api/integrations/zettle/connection'
    const connectionHeaders = { origin: 'http://127.0.0.1:3000' }
    const unavailable = await page.request.post(connectionPath, {
      headers: connectionHeaders,
      data: { tenantId: f.tenant },
    })
    expect(unavailable.status()).toBe(409)
    expect(await unavailable.json()).toEqual({ error: 'ZETTLE_NOT_CONNECTED' })
    expect(
      (
        await page.request.post(connectionPath, {
          headers: connectionHeaders,
          data: { tenantId: randomUUID() },
        })
      ).status(),
    ).toBe(409)
    expect(
      (
        await page.request.post(connectionPath, {
          headers: { origin: 'https://foreign.example' },
          data: { tenantId: f.tenant },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await page.request.post(connectionPath, {
          headers: connectionHeaders,
          data: { tenantId: f.tenant, apiKey: 'must-not-be-accepted' },
        })
      ).status(),
    ).toBe(400)

    await page.getByText(d.zettle.vatTitle, { exact: true }).click()
    await page
      .getByLabel(`${d.sales.vatModes.consignment_margin} (%)`, { exact: true })
      .fill('0')
    await page
      .getByRole('button', { name: d.zettle.saveMapping, exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              'select count(*) n from zettle_catalog_configs where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
      )
      .toBe('1')
    const fixtureHeaders = { authorization: `Bearer fixture:${f.tenant}` }
    const products = async () => {
      const r = await page.request.get('http://127.0.0.1:3456/_test/products', {
        headers: fixtureHeaders,
      })
      expect(r.ok()).toBe(true)
      return (await r.json()) as {
        uuid: string
        name: string
        externalReference: string
        variants: { uuid: string; price: { amount: number } }[]
      }[]
    }
    let lost = false
    await page.route('**/api/integrations/zettle', async (route) => {
      if (!lost && route.request().postDataJSON().action === 'sync') {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        lost = true
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: d.zettle.sync, exact: true }).click()
    const retryDone = page.waitForResponse(
      (r) => r.url().endsWith('/api/integrations/zettle') && r.status() === 200,
    )
    await page
      .getByRole('button', { name: d.zettle.retry, exact: true })
      .click()
    await (await retryDone).finished()
    await expect.poll(async () => (await products()).length).toBe(2)
    let exported = await products()
    expect(exported.map((p) => p.externalReference).sort()).toEqual(
      [`komisio:${item1}`, `komisio:${item2}`].sort(),
    )
    expect(
      exported.every(
        (p) =>
          p.variants[0].price.amount === 20000 && p.uuid !== p.variants[0].uuid,
      ),
    ).toBe(true)
    const first = exported.find(
      (p) => p.externalReference === `komisio:${item1}`,
    )!
    await f.asActor(f.actor, () =>
      f.db.query('select set_item_price($1,$2,$3,19000,$4)', [
        f.tenant,
        randomUUID(),
        item1,
        'Synthetic price update',
      ]),
    )
    await page.reload()
    await page.getByRole('button', { name: d.zettle.sync, exact: true }).click()
    await expect
      .poll(
        async () =>
          (await products()).find((p) => p.uuid === first.uuid)?.variants[0]
            .price.amount,
      )
      .toBe(19000)
    exported = await products()
    expect(exported.find((p) => p.uuid === first.uuid)?.variants[0].uuid).toBe(
      first.variants[0].uuid,
    )
    const checkout = await page.request.post(
      'http://127.0.0.1:3456/_test/sell',
      { headers: fixtureHeaders, data: { ids: exported.map((p) => p.uuid) } },
    )
    expect(checkout.status()).toBe(201)
    const headers = { origin: 'http://127.0.0.1:3000' }
    // Independent requests exercise database locking and immutable replay, with one owner only.
    const command = {
      action: 'sync',
      tenantId: f.tenant,
      requestId: randomUUID(),
      previous: null,
    }
    const responses = await Promise.all(
      [1, 2].map(() =>
        page.request.post('/api/integrations/zettle', {
          headers,
          data: command,
        }),
      ),
    )
    for (const r of responses) expect(r.status(), await r.text()).toBe(200)
    await page.reload()
    await page.getByRole('link', { name: new RegExp(d.zettle.open) }).click()
    await expect(
      page.getByText(d.zettle.recorded, { exact: true }),
    ).toBeVisible()
    const totals = (
      await f.db.query(
        'select (select count(*) from sales where tenant_id=$1) sales,(select count(*) from sale_lines where tenant_id=$1) lines,(select sum(amount_ore) from seller_ledger_entries where tenant_id=$1) credit,(select count(*) from pending_operations where tenant_id=$1) operations',
        [f.tenant],
      )
    ).rows[0]
    expect(totals).toEqual({
      sales: '1',
      lines: '2',
      credit: '15600',
      operations: '0',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: test.info().outputPath('zettle-receipt-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    // Keyset pagination keeps old unresolved imports reachable, with the same RLS.
    const more = Array.from({ length: 51 }, () => ({
      externalId: randomUUID(),
      occurredAt: '2026-09-10T10:00:00Z',
      currency: 'SEK',
      amountOre: 100,
      blockedReason: null,
      lines: [
        {
          lineNo: 1,
          reference: null,
          labelConflict: false,
          description: 'Older receipt pagination fixture',
          priceOre: 100,
        },
      ],
    }))
    await f.asActor(f.actor, () =>
      f.db.query('select record_zettle_page($1,$2,$3,$4,$5::jsonb)', [
        f.tenant,
        randomUUID(),
        '1',
        'synthetic-many',
        JSON.stringify(more),
      ]),
    )
    await page.goto('/intake/integrations')
    await page
      .getByText(`Zettle · ${d.integrationPage.manage}`, { exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: new RegExp(d.zettle.open) }),
    ).toHaveCount(50)
    await page.getByRole('link', { name: d.zettle.older, exact: true }).click()
    await expect(
      page.getByRole('link', { name: new RegExp(d.zettle.open) }),
    ).toHaveCount(2)
    await expect(
      page.getByRole('link', { name: d.zettle.newest, exact: true }),
    ).toBeVisible()
    const conflict = await page.request.post('/api/integrations/zettle', {
      headers,
      data: { ...command, tenantId: randomUUID() },
    })
    expect(conflict.status()).toBe(409)
    expect(
      (
        await page.request.post('/api/integrations/zettle', {
          headers: { origin: 'https://foreign.example' },
          data: command,
        })
      ).status(),
    ).toBe(403)
  } finally {
    await f.close()
  }
})
