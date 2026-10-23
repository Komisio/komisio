import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store can publish and revisit whole-method payment exclusions', async ({
  page,
}) => {
  const email = `payment-map-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=accounts')
    await page.getByText(d.accounting.paymentHeading, { exact: true }).click()
    await page
      .locator('input[name="exclude:mobilepay"]')
      .fill('Store books all MobilePay sales externally')
    await page
      .getByRole('button', { name: d.accounting.publishMap, exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              'select count(*)::int n from accounting_maps where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
      )
      .toBe(1)
    await page.reload()
    await page.getByText(d.accounting.paymentHeading, { exact: true }).click()
    await expect(page.locator('input[name="exclude:mobilepay"]')).toHaveValue(
      'Store books all MobilePay sales externally',
    )
    const map = (
      await f.db.query('select map from accounting_maps where tenant_id=$1', [
        f.tenant,
      ])
    ).rows[0].map
    expect(map['payment:mobilepay:grossOre']).toEqual(
      map['payment:mobilepay:refundsOre'],
    )
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
