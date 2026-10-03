import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('receipt matching searches for an item, requires confirmation and retries the same choice', async ({
  page,
}, testInfo) => {
  const email = `receipt-search-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic match jacket')
    const external = randomUUID()
    await f.db.query('select record_zettle_page($1,$2,null,$3,$4::jsonb)', [
      f.tenant,
      randomUUID(),
      'synthetic-search',
      JSON.stringify([
        {
          externalId: external,
          occurredAt: '2020-01-02T10:00:00Z',
          currency: 'SEK',
          amountOre: 20000,
          blockedReason: null,
          lines: [
            {
              lineNo: 1,
              reference: null,
              labelConflict: false,
              description: 'Synthetic unmatched jacket',
              priceOre: 20000,
            },
          ],
        },
      ]),
    ])
    const receipt = (
      await f.db.query(
        'select id from zettle_imports where tenant_id=$1 and external_id=$2',
        [f.tenant, external],
      )
    ).rows[0].id
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/integrations/${receipt}`)
    const form = page
      .locator('form')
      .filter({ has: page.locator('input[name="itemId"]') })
    const confirm = form.getByRole('button', {
      name: d.zettle.match,
      exact: true,
    })
    await expect(confirm).toBeDisabled()
    await form.locator('summary').click()
    const fullId = form.getByLabel(d.zettle.item, { exact: true })
    await fullId.fill('not-an-item-id')
    await expect(confirm).toBeDisabled()
    await fullId.fill(item)
    await expect(confirm).toBeEnabled()
    await fullId.fill('')
    await form.locator('summary').click()
    await form
      .getByLabel(d.sales.search, { exact: true })
      .fill('No such synthetic item')
    await form
      .getByRole('button', { name: d.sales.searchButton, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.sales.noMatches)
    await expect(confirm).toBeDisabled()
    await form
      .getByLabel(d.sales.search, { exact: true })
      .fill('Synthetic match')
    await form.getByLabel(d.sales.search, { exact: true }).press('Enter')
    const choose = form.getByRole('button', {
      name: new RegExp(`${d.zettle.chooseItem}.*Synthetic match jacket`),
    })
    await expect(choose).toBeVisible()
    await choose.click()
    await expect(confirm).toBeFocused()
    await expect(form.getByRole('status')).toContainText(
      'Synthetic match jacket',
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int count from sales where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('selected-receipt-item-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/integrations/zettle', async (route) => {
      requests.push(route.request().postDataJSON())
      if (requests.length !== 1) return route.continue()
      const result = await route.fetch()
      expect(result.status()).toBe(200)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    await confirm.click()
    await expect(
      form.getByRole('button', { name: d.sales.remove, exact: true }),
    ).toBeDisabled()
    await form
      .getByRole('button', { name: d.zettle.retry, exact: true })
      .click()
    await expect(
      page.getByText(d.zettle.recorded, { exact: true }),
    ).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0].itemId).toBe(item)
    expect(
      (
        await f.db.query('select item_id from sale_lines where tenant_id=$1', [
          f.tenant,
        ])
      ).rows,
    ).toEqual([{ item_id: item }])
  } finally {
    await f.close()
  }
})
