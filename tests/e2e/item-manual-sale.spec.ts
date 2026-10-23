import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('item sale entry preselects current price and refuses a stale sold link', async ({
  page,
}) => {
  const email = `item-sale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic item sale')
    await f.commit()
    await page.goto(`/intake/items/${item}`)
    await page
      .getByRole('link', { name: d.sales.markSold, exact: true })
      .click()
    await expect(page.locator('.sale-cart li')).toHaveCount(1)
    await expect(page.locator(`#price-${item}`)).toHaveValue('200.00')
    await page.locator(`#price-${item}`).fill('175.00')
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(
      page.getByText(d.sales.recorded, { exact: false }),
    ).toBeVisible()
    await page.getByRole('link', { name: d.sales.open, exact: true }).click()
    await expect(page).toHaveURL(/\/intake\/sales\/[a-f0-9-]+/)
    const rows = (
      await f.db.query('select total_ore from sales where tenant_id=$1', [
        f.tenant,
      ])
    ).rows
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].total_ore)).toBe(17500)
    await page.goto(`/intake/items/${item}`)
    await expect(
      page.getByRole('link', { name: d.sales.markSold, exact: true }),
    ).toHaveCount(0)
    await page.goto(`/intake/sales?item=${item}#sales-manual`)
    await expect(
      page.getByText(d.sales.itemUnavailable, { exact: true }),
    ).toBeVisible()
    await expect(page.locator('.sale-cart li')).toHaveCount(0)
  } finally {
    await f.close()
  }
})
