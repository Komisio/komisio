import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('Zettle fixture: lost sync response, match, staged approval and concurrent replay', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000)
  const email = `zettle-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email),
    other = await browser.newContext(),
    approver = await other.newPage()
  try {
    const item1 = await f.item('Zettle jacket'),
      item2 = await f.item('Zettle bag')
    await f.commit()
    const secondEmail = `zettle-approver-${randomUUID()}@example.test`
    await register(
      approver,
      secondEmail,
      `K!${randomBytes(16).toString('hex')}`,
    )
    const second = (
      await f.db.query('select id from auth.users where email=$1', [
        secondEmail,
      ])
    ).rows[0].id
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'staff')",
      [f.tenant, second],
    )
    await page.goto('/intake/integrations')
    await expect(page.getByText(d.zettle.fixture)).toBeVisible()
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
    await page
      .getByRole('button', { name: d.zettle.retry, exact: true })
      .click()
    await page.getByRole('link', { name: new RegExp(d.zettle.open) }).click()
    await expect(
      page.getByText(d.zettle.unmatched, { exact: true }),
    ).toHaveCount(2)
    for (const [i, itemId] of [item1, item2].entries()) {
      const row = page.getByRole('region', {
        name: `${d.zettle.line} ${i + 1}`,
        exact: true,
      })
      await row.getByLabel(d.zettle.item, { exact: true }).fill(itemId)
      await row
        .getByRole('button', { name: d.zettle.match, exact: true })
        .click()
      await expect(
        row.getByRole('link', { name: itemId, exact: true }),
      ).toBeVisible()
    }
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
    const receipt = (
      await f.db.query('select id from zettle_imports where tenant_id=$1', [
        f.tenant,
      ])
    ).rows[0].id
    expect(
      (
        await f.db.query('select count(*) n from sales where tenant_id=$1', [
          f.tenant,
        ])
      ).rows[0].n,
    ).toBe('0')
    await page
      .getByRole('button', { name: d.zettle.stage, exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: d.zettle.done }),
    ).toBeVisible()
    const op = (
      await f.db.query(
        "select id from pending_operations where tenant_id=$1 and kind='recordZettlePurchase'",
        [f.tenant],
      )
    ).rows[0].id
    const headers = { origin: 'http://127.0.0.1:3000' }
    const self = await page.request.post('/api/operations', {
      headers,
      data: {
        tenantId: f.tenant,
        requestId: randomUUID(),
        operationId: op,
        decision: 'approve',
        reason: '',
      },
    })
    expect(self.status()).toBe(403)
    await approver.goto(`/intake/operations/${op}`)
    await expect(
      approver.getByRole('region', { name: d.operations.zettleReceipt }),
    ).toContainText('300.00 SEK')
    await approver.getByLabel(d.operations.confirm, { exact: true }).check()
    await approver
      .getByRole('button', { name: d.operations.approve, exact: true })
      .click()
    await expect(
      approver.getByText(d.operations.status.executed, { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText(d.zettle.recorded, { exact: true }),
    ).toBeVisible()
    // Two independent HTTP requests / database connections replay the same proposal.
    const command = {
      action: 'stage',
      tenantId: f.tenant,
      requestId: randomUUID(),
      importId: receipt,
      mappingRevision: 2,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }
    const proposals = await Promise.all([
      page.request.post('/api/integrations/zettle', { headers, data: command }),
      page.request.post('/api/integrations/zettle', { headers, data: command }),
    ])
    for (const response of proposals) expect(response.status()).toBe(200)
    const decisions = await Promise.all(
      [1, 2].map(() =>
        approver.request.post('/api/operations', {
          headers,
          data: {
            tenantId: f.tenant,
            requestId: randomUUID(),
            operationId: command.requestId,
            decision: 'approve',
            reason: '',
          },
        }),
      ),
    )
    expect(decisions.map((r) => r.status()).sort()).toEqual([200, 409])
    const totals = (
      await f.db.query(
        'select (select count(*) from sales where tenant_id=$1) sales,(select count(*) from sale_lines where tenant_id=$1) lines,(select sum(amount_ore) from seller_ledger_entries where tenant_id=$1) credit',
        [f.tenant],
      )
    ).rows[0]
    expect(totals).toEqual({ sales: '1', lines: '2', credit: '12000' })
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
        'synthetic-page-1',
        'synthetic-many',
        JSON.stringify(more),
      ]),
    )
    await page.goto('/intake/integrations')
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
    await other.close()
    await f.close()
  }
})
