import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('sale cart finds older stock, scans a reference and safely retries a multi-item sale', async ({
  page,
}) => {
  const email = `sale-cart-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const first = await f.item('Older blue lamp'),
      second = await f.item('Second red lamp')
    await f.db.query('select set_item_price($1,$2,$3,50000,$4)', [
      f.tenant,
      randomUUID(),
      second,
      'Current catalogue price',
    ])
    for (let i = 0; i < 1000; i++) await f.item(`Later synthetic item ${i}`)
    await f.commit()
    await page.goto('/intake/sales')
    await page
      .getByRole('tab', { name: d.sales.manualTab, exact: true })
      .click()
    const search = page.getByLabel(d.sales.search, { exact: true })
    await search.fill('Older blue lamp')
    await search.press('Enter')
    await page.getByRole('button', { name: d.sales.add, exact: true }).click()
    await expect(page.locator('.sale-cart li')).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: d.sales.added, exact: true }),
    ).toBeDisabled()
    await search.fill(`I-${second.slice(0, 8).toUpperCase()}`)
    await search.press('Enter')
    await page.getByRole('button', { name: d.sales.add, exact: true }).click()
    await expect(page.locator('.sale-cart li')).toHaveCount(2)
    await page.locator(`#price-${first}`).fill('125,50')
    const secondRow = page
      .locator('.sale-cart li')
      .filter({ hasText: 'Second red lamp' })
    const discount = secondRow.getByLabel(d.sales.discount, { exact: true })
    const unit = secondRow.getByLabel(d.sales.discountUnit)
    const price = secondRow.getByLabel(d.sales.price, { exact: false })
    await discount.fill('100')
    await expect(discount).toHaveAttribute('aria-invalid', 'true')
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(discount).toBeFocused()
    await unit.selectOption('amount')
    await expect(price).toHaveValue('400.00')
    await discount.fill('125,50')
    await expect(price).toHaveValue('374.50')
    await discount.clear()
    await expect(price).toHaveValue('500.00')
    await unit.selectOption('percent')
    await discount.fill('10')
    await price.fill('450,50')
    await expect(discount).toBeEmpty()
    await discount.fill('20')
    await expect(price).toHaveValue('400.00')
    await expect(page.locator('.sale-total')).toContainText('525.50 SEK')
    await page.screenshot({
      path: 'private/sale-cart-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/sale-cart-mobile.png',
      fullPage: true,
    })
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page.route(
      '**/api/intake',
      async (route) => {
        const r = await route.fetch()
        expect(r.status()).toBe(200)
        await route.abort('failed')
      },
      { times: 1 },
    )
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(page.locator(`#price-${first}`)).toBeDisabled()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(
      page.getByText(d.sales.recorded, { exact: false }),
    ).toBeVisible()
    const sales = (
      await f.db.query('select id,total_ore from sales where tenant_id=$1', [
        f.tenant,
      ])
    ).rows
    expect(sales).toHaveLength(1)
    expect(Number(sales[0].total_ore)).toBe(52550)
    const discounted = await f.db.query(
      `select l.price_ore, l.commission_ore, e.amount_ore as credited_ore
       from sale_lines l join seller_ledger_entries e on e.reference_id=l.id and e.kind='credit_sale'
       where l.sale_id=$1 and l.item_id=$2`,
      [sales[0].id, second],
    )
    expect(discounted.rows).toEqual([
      { price_ore: '40000', commission_ore: '24000', credited_ore: '16000' },
    ])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sale_lines where sale_id=$1',
          [sales[0].id],
        )
      ).rows[0].n,
    ).toBe(2)
    await search.fill('Older blue lamp')
    await search.press('Enter')
    await expect(
      page.getByText(d.sales.noMatches, { exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
