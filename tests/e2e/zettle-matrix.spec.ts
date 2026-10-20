import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'
const locales: Locale[] = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']

test('NOK export, decimal VAT entry, foreign receipt hold and all eight workspace languages', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(240000)
  const email = `zettle-matrix-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const origin = new URL(baseURL!).origin
  const headers = { origin }
  const fixtureHeaders = { authorization: `Bearer fixture:${f.tenant}` }
  try {
    await f.db.query(
      'select publish_store_policy($1,$2,(current_store_policy($1)->>\'id\')::uuid,(current_store_policy($1)->\'policy\')||\'{"currency":"NOK","vatRatePercent":25}\')',
      [f.tenant, randomUUID()],
    )
    const item = await f.item('Läderjacka – blå æøåäöÆØÅÄÖ ß é ñ ł 🧥')
    await f.commit()
    expect(
      (
        await page.request.post('http://127.0.0.1:3456/_test/currency', {
          headers: fixtureHeaders,
          data: { currency: 'NOK' },
        })
      ).status(),
    ).toBe(200)
    await page.goto('/intake/integrations?provider=paypal')
    const sv: Dictionary = JSON.parse(
      readFileSync(new URL('../../messages/sv.json', import.meta.url), 'utf8'),
    )
    await page
      .getByRole('tab', {
        name: sv.integrationPage.paypalWorkspace.settings,
        exact: true,
      })
      .click()
    await page
      .getByText(sv.integrationPage.paypalWorkspace.vat, { exact: true })
      .click()
    await page
      .getByLabel(`${sv.sales.vatModes.consignment_margin} (%)`, {
        exact: true,
      })
      .fill('25.5')
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/integrations/zettle') &&
        r.request().postDataJSON().action === 'configure',
    )
    await page
      .getByRole('button', { name: sv.zettle.saveMapping, exact: true })
      .click()
    expect((await saved).status()).toBe(200)
    await expect(
      page.getByRole('button', { name: sv.zettle.saveMapping, exact: true }),
    ).toBeEnabled()
    const sync = async () => {
      const r = await page.request.post('/api/integrations/zettle', {
        headers,
        data: {
          action: 'sync',
          tenantId: f.tenant,
          requestId: randomUUID(),
          previous: null,
        },
      })
      expect(r.status(), await r.text()).toBe(200)
    }
    await sync()
    const products = await (
      await page.request.get('http://127.0.0.1:3456/_test/products', {
        headers: fixtureHeaders,
      })
    ).json()
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      externalReference: `komisio:${item}`,
      vatPercentage: 25.5,
      variants: [{ price: { amount: 20000, currencyId: 'NOK' } }],
    })
    const sold = await page.request.post('http://127.0.0.1:3456/_test/sell', {
      headers: fixtureHeaders,
      data: { ids: [products[0].uuid], currency: 'EUR' },
    })
    expect(sold.status()).toBe(201)
    await sync()
    const receipt = (
      await f.db.query(
        'select id,blocked_reason,currency from zettle_imports where tenant_id=$1',
        [f.tenant],
      )
    ).rows[0]
    expect(receipt).toMatchObject({
      blocked_reason: 'currency',
      currency: 'EUR',
    })
    const totals = (
      await f.db.query(
        'select (select count(*) from sales where tenant_id=$1) sales,(select count(*) from seller_ledger_entries where tenant_id=$1) credits,(select count(*) from pending_operations where tenant_id=$1) operations',
        [f.tenant],
      )
    ).rows[0]
    expect(totals).toEqual({ sales: '0', credits: '0', operations: '0' })
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of locales) {
      const d: Dictionary = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: origin }])
      await page.goto('/intake/integrations?provider=paypal')
      await expect(
        page.getByRole('tab', {
          name: d.integrationPage.paypalWorkspace.sales,
          exact: true,
        }),
      ).toBeVisible()
      await page
        .getByRole('tab', {
          name: d.integrationPage.paypalWorkspace.settings,
          exact: true,
        })
        .click()
      await expect(
        page.getByRole('button', { name: d.zettle.oauth.connect, exact: true }),
      ).toBeVisible()
      await page
        .getByText(d.integrationPage.paypalWorkspace.vat, { exact: true })
        .click()
      const vat = page.getByLabel(
        `${d.sales.vatModes.consignment_margin} (%)`,
        { exact: true },
      )
      await expect(vat).toHaveValue('25.5')
      const field = vat.locator('..')
      // Coverage-only baseline: fixed decimal percentage, localized explanation.
      await expect(field.getByRole('status')).toHaveText(
        `${d.zettle.engineVat}: 25.00 % · ${d.zettle.vatComparison.mismatch}`,
      )
      await vat.fill('25')
      await expect(field.getByRole('status')).toHaveText(
        `${d.zettle.engineVat}: 25.00 % · ${d.zettle.vatComparison.match}`,
      )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page
        .getByRole('tab', {
          name: d.integrationPage.paypalWorkspace.sales,
          exact: true,
        })
        .click()
      const row = page.locator('.pos-receipts tbody tr')
      await expect(row).toContainText(
        d.integrationPage.paypalWorkspace.attention,
      )
      // Receipt amounts remain exact fixed decimals plus ISO code in this slice.
      await expect(row).toContainText('200.00 EUR')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await row.getByRole('link').click()
      await expect(
        page.getByRole('status').filter({ hasText: d.zettle.blocked }),
      ).toHaveText(`${d.zettle.blocked}: currency. ${d.zettle.unsupported}`)
      await expect(
        page.getByText(`${d.zettle.total}: 200.00 EUR`, { exact: true }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
  } finally {
    await f.close()
  }
})
