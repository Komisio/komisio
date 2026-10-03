import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('sales and receipt details remain readable while returns require an explicit action', async ({
  page,
}, testInfo) => {
  const email = `sales-readability-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic receipt jacket')
    const sale = randomUUID()
    const reference = `synthetic-${'receipt-reference-'.repeat(10)}`
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-01-02T10:01:55Z','SEK',$4::jsonb)",
      [
        f.tenant,
        sale,
        reference,
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto('/intake/sales')
    const row = page.locator('.sales-register-row')
    await expect(row).toContainText('200.00 SEK')
    await expect(row).toContainText(d.sales.providers.manual)
    await expect(row).not.toContainText(reference)
    await expect(row.locator('time')).toHaveAttribute(
      'datetime',
      '2020-01-02T10:01:55+00:00',
    )
    await expect(row.locator('time')).not.toContainText(':55')
    await expect(page.getByText(d.sales.listHint)).toBeVisible()
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
    await page.screenshot({
      path: testInfo.outputPath('sales-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    await row.click()
    await expect(page).toHaveURL(`/intake/sales/${sale}`)
    await expect(page.getByText(reference, { exact: true })).toBeHidden()
    await expect(
      page.getByLabel(d.returns.reason, { exact: true }),
    ).toBeHidden()
    await page.locator('.sale-reference > summary').click()
    await expect(page.getByText(reference, { exact: true })).toBeVisible()
    await page.locator('.sale-line-details > summary').click()
    await expect(page.locator('.sale-line-details')).toContainText('120.00 SEK')
    await expect(page.locator('.sale-line-details')).toContainText('80.00 SEK')
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
    await page.locator('.sale-return > summary').click()
    await page
      .getByLabel(d.returns.reason, { exact: true })
      .fill('Synthetic damaged item')
    await page
      .getByLabel(d.returns.confirm.replace('{amount}', '200.00'), {
        exact: true,
      })
      .check()
    await page
      .getByRole('button', { name: d.returns.record, exact: true })
      .click()
    await expect(page.getByText(/Returnerad/).first()).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('receipt-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 1280)
    await page.screenshot({
      path: testInfo.outputPath('receipt-desktop.png'),
      fullPage: true,
      caret: 'initial',
    })
    const returned = (
      await f.db.query(
        'select refund_ore,reason from sale_returns where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(returned).toEqual([
      { refund_ore: '20000', reason: 'Synthetic damaged item' },
    ])
  } finally {
    await f.close()
  }
})
