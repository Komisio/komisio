import { test, expect, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff economy forms provide a reload when the active store became stale', async ({
  page,
}) => {
  const email = `economy-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const sold = await f.item('Synthetic sold item')
    await f.item('Synthetic due item')
    const sale = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-03-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        sale,
        randomUUID(),
        JSON.stringify([{ itemId: sold, priceOre: 20000 }]),
      ],
    )
    await f.db.query('select adjust_seller_ledger($1,$2,$3,50000,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic stale fixture',
    ])
    await f.db.query("select generate_day_close($1,$2,'2020-03-02')", [
      f.tenant,
      randomUUID(),
    ])
    await f.db.query('select publish_accounting_map($1,$2,null,$3::jsonb)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({
        grossOre: { account: '1930', side: 'debit' },
        commissionOre: { account: '3010', side: 'credit' },
        sellerCreditOre: { account: '2890', side: 'credit' },
      }),
    ])
    await f.commit()
    const actions: string[] = []
    await page.route('**/api/intake', async (route) => {
      actions.push(route.request().postDataJSON().action)
      await route.fulfill({ status: 409, json: { error: 'TENANT_CHANGED' } })
    })
    async function refuse(form: Locator, button: string) {
      await form.getByRole('button', { name: button, exact: true }).click()
      await expect(form.getByRole('alert')).toHaveText(d.intake.changed)
      const reload = form.getByRole('button', {
        name: d.intake.reload,
        exact: true,
      })
      await expect(reload).toBeVisible()
      await expect(
        form.getByRole('button').filter({ hasNotText: d.intake.reload }),
      ).toBeDisabled()
      await reload.click()
      await expect(page.getByRole('alert')).toHaveCount(0)
    }
    await page.goto('/intake/payouts')
    const request = page.getByTestId('payout-request')
    await request.locator('summary').click()
    await request.getByLabel(d.payouts.amount, { exact: true }).fill('100')
    await request.getByRole('checkbox').check()
    await refuse(request, d.payouts.request)
    const settlement = page.getByTestId('payout-settlement')
    await settlement.locator('summary').click()
    await settlement
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('Synthetic batch')
    await settlement
      .getByLabel(d.payouts.settleConfirm, { exact: true })
      .check()
    await refuse(settlement, d.payouts.settle.replace('{count}', '1'))
    await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
    const statement = page
      .locator('form')
      .filter({ has: page.locator('#statement-from') })
    await statement.getByRole('checkbox').check()
    await refuse(statement, d.statements.issue)
    await page
      .locator('summary')
      .filter({ hasText: d.ledger.adjustHeading })
      .click()
    const ledger = page
      .locator('form')
      .filter({ has: page.locator('#ledger-amount') })
    await ledger.getByLabel(d.ledger.amount, { exact: true }).fill('10')
    await ledger
      .getByLabel(d.ledger.reason, { exact: true })
      .fill('Synthetic correction')
    await ledger.getByRole('checkbox').check()
    await refuse(ledger, d.ledger.adjust)
    await page.goto('/intake/accounting')
    const close = page
      .locator('form')
      .filter({ has: page.locator('#close-date') })
    await close
      .getByLabel(d.accounting.date, { exact: true })
      .fill('2020-03-03')
    await refuse(close, d.accounting.generate)
    await refuse(page.locator('.accounting-voucher'), d.accounting.export)
    await page.goto(`/intake/sales/${sale}`)
    await page.locator('.sale-return > summary').click()
    const returns = page.locator('.sale-return form')
    await returns
      .getByLabel(d.returns.reason, { exact: true })
      .fill('Synthetic return')
    await returns.getByRole('checkbox').check()
    await refuse(returns, d.returns.record)
    await page.goto('/intake/lifecycle')
    await page.locator('.lifecycle-automation > summary').click()
    await refuse(
      page.locator('.lifecycle-automation form'),
      d.lifecycle.applyAllDue.replace('{count}', '1'),
    )
    expect(actions).toEqual([
      'requestPayout',
      'settlePayouts',
      'issueStatement',
      'adjustSellerLedger',
      'generateDayClose',
      'exportDayClose',
      'recordReturn',
      'applyDueMarkdowns',
    ])
    for (const table of [
      'payouts',
      'settlement_statements',
      'accounting_exports',
      'sale_returns',
    ])
      expect(
        (
          await f.db.query(
            `select count(*)::int n from ${table} where tenant_id=$1`,
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(0)
  } finally {
    await f.close()
  }
})
