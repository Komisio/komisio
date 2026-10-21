import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('DKK manual sale explains missing VAT policy and preserves unknown-result retries', async ({
  page,
}) => {
  const email = `sale-vat-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      `select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,
        ((current_store_policy($1)->'policy')-'vatModeConsignmentPrivate'-'vatModeStoreOwned') || '{"currency":"DKK"}')`,
      [f.tenant, randomUUID()],
    )
    const item = await f.item('Synthetic Danish manual sale')
    await f.commit()
    await page.goto('/intake/sales#sales-manual')
    const search = page.getByLabel(d.sales.search, { exact: true })
    await search.fill('Synthetic Danish manual sale')
    await search.press('Enter')
    await page.getByRole('button', { name: d.sales.add, exact: true }).click()
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    const commands: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'recordSale') return route.continue()
      commands.push(command)
      const response = await route.fetch()
      if (commands.length <= 2) {
        expect(response.status()).toBe(409)
        expect((await response.json()).error).toBe('VAT_MODE_NOT_SET')
      }
      // A server failure carrying the same text must not unlock the attempt.
      await route.fulfill({
        response,
        ...(commands.length === 1 ? { status: 500 } : {}),
      })
    })
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(page.locator('.sale-workspace').getByRole('alert')).toHaveText(
      d.intake.failed,
    )
    await expect(page.locator(`#price-${item}`)).toBeDisabled()
    await expect(
      page.getByRole('link', { name: d.sales.configureVat }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page.locator('.sale-workspace').getByRole('alert')).toHaveText(
      d.intake.saleVatRequired,
    )
    await expect(page.locator(`#price-${item}`)).toBeEnabled()
    await expect(
      page.getByRole('link', { name: d.sales.configureVat }),
    ).toHaveAttribute('href', '/settings#policy-section-vat')
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sales where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    // Synthetic owner makes the policy choice explicitly through the engine.
    await f.asActor(f.actor, () =>
      f.db.query(
        `select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,
        (current_store_policy($1)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin"}')`,
        [f.tenant, randomUUID()],
      ),
    )
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: d.sales.open, exact: true }),
    ).toBeVisible()
    await expect(page.locator('.sale-cart li')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select currency,total_ore::text from sales where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ currency: 'DKK', total_ore: '20000' }])
  } finally {
    await f.close()
  }
})
