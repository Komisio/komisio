import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }

// This journey needs the isolated provider preload in economic.playwright.config.
test('e-conomic connects, maps, sends drafts once, holds an uncertain send and reconciles', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.KOMISIO_ECONOMIC_SIMULATOR !== 'true',
    'Run with economic.playwright.config.ts',
  )
  await page.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
      return route.abort()
    return route.continue()
  })
  const email = `economic-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await db.connect()
  const actor = (
    await db.query('select id from auth.users where email=$1', [email])
  ).rows[0].id
  let tenant = ''
  const closes = [randomUUID(), randomUUID()]
  try {
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
    tenant = (
      await db.query("select create_tenant_with_locale($1,$2,$3,'dk') id", [
        'Synthetic Danish store',
        `dk-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    // Keep the test user's UI Swedish while the store currency remains DKK.
    await db.query('commit')
    await db.query(
      "insert into day_closes(id,tenant_id,close_date,version,gross_ore,commission_ore,generated_by) values($1,$2,'2020-03-02',1,12345,12345,$3),($4,$2,'2020-03-03',1,12345,12345,$3)",
      [closes[0], tenant, actor, closes[1]],
    )
    await page.route(
      '**/api/integrations/economic/connect?*',
      async (route) => {
        const response = await route.fetch({ maxRedirects: 0 })
        const installation = new URL(response.headers().location)
        expect(installation.origin).toBe('https://secure.e-conomic.com')
        expect(installation.searchParams.get('appPublicToken')).toBe(
          'synthetic-economic-public',
        )
        const callback = new URL(installation.searchParams.get('redirectUrl')!)
        callback.searchParams.set('token', 'synthetic-economic-grant')
        await route.fulfill({
          response,
          status: 302,
          headers: { ...response.headers(), location: callback.toString() },
        })
      },
    )
    await page.goto('/intake/accounting?view=settings')
    const connection = page.locator('#economic-connection')
    await connection
      .getByRole('link', { name: d.economic.connect, exact: true })
      .click()
    await expect(
      connection.getByText(d.economic.connected, { exact: true }),
    ).toBeVisible()
    await expect(
      connection.getByRole('link', { name: d.economic.reconnect, exact: true }),
    ).toBeVisible()
    await expect(page).not.toHaveURL(/token=/)
    await page.goto('/intake/accounting?view=accounts&destination=economic')
    await page.getByRole('button', { name: d.economic.loadCatalogue }).click()
    await page
      .getByRole('combobox', { name: d.economic.journal, exact: true })
      .selectOption('1')
    // Existing local edits survive suggestions; a lost reply recovers the same
    // metered attempt and goes through the real staged-operation approval route.
    await page
      .getByRole('combobox', {
        name: `${d.accounting.amountKeys.grossOre} · ${d.economic.post}`,
        exact: true,
      })
      .selectOption('post')
    await page
      .getByRole('combobox', {
        name: `${d.accounting.amountKeys.grossOre} · ${d.accounting.account}`,
        exact: true,
      })
      .selectOption('10000')
    let aiRequest = ''
    let aiCalls = 0
    await page.route('**/api/accounting/assistance', async (route) => {
      const c = route.request().postDataJSON()
      expect(c.destination).toBe('economic')
      expect(c.tenantId).toBe(tenant)
      expect(c.agreementNumber).toBe(123456)
      if (aiRequest) expect(c.requestId).toBe(aiRequest)
      aiRequest = c.requestId
      await db.query('begin')
      await db.query('set local role authenticated')
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
      const revision = (
        await db.query('select read_economic_connection($1) value', [tenant])
      ).rows[0].value.revision
      const started = (
        await db.query(
          'select begin_economic_accounting_assistance($1,$2,$3,$4,$5,$6,$7,$8) value',
          [
            tenant,
            c.requestId,
            c.baseId,
            c.language,
            'fixture',
            c.agreementNumber,
            revision,
            JSON.stringify([
              { account: '10000', name: 'Bank', type: 'status' },
              { account: '30000', name: 'Sales', type: 'profitAndLoss' },
            ]),
          ],
        )
      ).rows[0].value
      const output = {
        rows: [
          {
            key: 'grossOre',
            account: '30000',
            side: 'credit',
            reason: 'Synthetic suggestion, preserve local edit',
          },
          {
            key: 'commissionOre',
            account: '30000',
            side: 'credit',
            reason: 'Review income account',
          },
        ],
        warnings: ['Synthetic accounting review'],
      }
      if (started.reserved)
        await db.query(
          'select complete_accounting_assistance($1,$2,$3,100,50)',
          [tenant, c.requestId, output],
        )
      await db.query('commit')
      if (++aiCalls === 1) return route.abort()
      await route.fulfill({
        json: { id: c.requestId, status: 'ready', output },
      })
    })
    await page
      .getByRole('button', { name: d.accounting.ai.create, exact: true })
      .click()
    await expect(
      page.getByText(d.accounting.ai.pending, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: d.accounting.ai.check, exact: true })
      .click()
    await expect(
      page.getByText(d.accounting.ai.review, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('combobox', {
        name: `${d.accounting.amountKeys.grossOre} · ${d.accounting.account}`,
        exact: true,
      }),
    ).toHaveValue('10000')
    await expect(
      page.getByRole('combobox', {
        name: `${d.accounting.amountKeys.commissionOre} · ${d.accounting.account}`,
        exact: true,
      }),
    ).toHaveValue('30000')
    await expect(
      page.getByRole('combobox', {
        name: `${d.accounting.amountKeys.commissionOre} · ${d.economic.vatCode}`,
        exact: true,
      }),
    ).toHaveValue('')
    expect(
      (
        await db.query(
          'select count(*)::int n from economic_maps where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await db.query(
          'select count(*)::int n from accounting_ai_attempts where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    for (const [key, account, side] of [
      ['grossOre', '10000', 'debit'],
      ['commissionOre', '30000', 'credit'],
    ]) {
      const label =
        d.accounting.amountKeys[key as keyof typeof d.accounting.amountKeys]
      await page
        .getByRole('combobox', {
          name: `${label} · ${d.economic.post}`,
          exact: true,
        })
        .selectOption('post')
      await page
        .getByRole('combobox', {
          name: `${label} · ${d.accounting.account}`,
          exact: true,
        })
        .selectOption(account)
      await page
        .getByRole('combobox', {
          name: `${label} · ${d.accounting.side}`,
          exact: true,
        })
        .selectOption(side)
      const vat = page.getByRole('combobox', {
        name: `${label} · ${d.economic.vatCode}`,
        exact: true,
      })
      await expect(vat.locator('option[value="U25"]')).toBeDisabled()
      await vat.selectOption('Z0')
    }
    await page.getByRole('button', { name: d.economic.saveMap }).click()
    await expect(
      page.getByText(`${d.accounting.mapVersion} 1`, { exact: false }),
    ).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('economic-map.png') })
    await page.goto('/intake/accounting?destination=economic')
    const first = page
      .locator('details.accounting-record')
      .filter({ hasText: '2020-03-02' })
    await first.locator('summary').click()
    await first.getByRole('button', { name: d.economic.prepare }).click()
    await first.getByRole('link', { name: d.accounting.openExport }).click()
    await page.getByRole('button', { name: d.economic.send }).click()
    await expect(
      page.getByText(`${d.economic.sent} 42`, { exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('economic-export.png') })
    await page.reload()
    await expect(
      page.getByRole('button', { name: d.economic.send }),
    ).toHaveCount(0)
    const counts = await page.request.get('http://127.0.0.1:3468/control')
    const delivery = await counts.json()
    expect(delivery.posts).toBe(1)
    expect(delivery.entries).toHaveLength(2)
    expect(
      delivery.entries.map(
        (row: { voucher: { voucherNumber: number } }) =>
          row.voucher.voucherNumber,
      ),
    ).toEqual([42, 42])

    await page.request.post('http://127.0.0.1:3468/control?mode=lost')
    await page.goto('/intake/accounting?destination=economic')
    const second = page
      .locator('details.accounting-record')
      .filter({ hasText: '2020-03-03' })
    await second.locator('summary').click()
    await second.getByRole('button', { name: d.economic.prepare }).click()
    await second.getByRole('link', { name: d.accounting.openExport }).click()
    await page.getByRole('button', { name: d.economic.send }).click()
    await expect(
      page.getByText(d.economic.pending, { exact: false }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.economic.send }),
    ).toHaveCount(0)
    await page.getByText(d.fortnox.reconcileTitle, { exact: true }).click()
    await page.getByLabel(d.economic.journal, { exact: true }).fill('1')
    await page.getByLabel(d.fortnox.reconcileNumber).fill('42')
    await page
      .getByLabel(d.fortnox.reconcileEvidence)
      .fill('All synthetic lines verified in one voucher')
    await page.getByRole('button', { name: d.fortnox.reconcileConfirm }).click()
    await expect(
      page.getByText(`${d.economic.sent} 42`, { exact: true }),
    ).toBeVisible()
    expect(
      (await (await page.request.get('http://127.0.0.1:3468/control')).json())
        .posts,
    ).toBe(2)
    await page.request.post('http://127.0.0.1:3468/control?mode=normal')
    await page.goto('/intake/accounting?view=settings')
    await connection
      .getByRole('button', { name: d.fortnox.disconnect, exact: true })
      .click()
    await expect(
      connection.getByText(d.economic.notConnected, { exact: true }),
    ).toBeVisible()
    expect(
      (
        await db.query(
          'select count(*)::int count from economic_connections where tenant_id=$1',
          [tenant],
        )
      ).rows[0].count,
    ).toBe(0)
    expect(
      (
        await db.query(
          'select count(*)::int count from economic_send_events where tenant_id=$1',
          [tenant],
        )
      ).rows[0].count,
    ).toBe(1)
  } finally {
    await db.end()
    await page.request.post('http://127.0.0.1:3468/control?mode=normal')
  }
})
