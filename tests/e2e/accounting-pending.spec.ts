import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('pending accounting send stays visible and exact older export can be reconciled without resending', async ({
  page,
  browser,
}, testInfo) => {
  const email = `accounting-pending-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email),
    close = randomUUID(),
    exportId = randomUUID(),
    sendId = randomUUID()
  try {
    const item = await f.item('Synthetic pending accounting item')
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-01-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.db.query("select generate_day_close($1,$2,'2020-01-02')", [
      f.tenant,
      close,
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
    await f.db.query('select export_day_close($1,$2,$3)', [
      f.tenant,
      exportId,
      close,
    ])
    await f.db.query(
      "select store_fortnox_connection($1,'1751085','Synthetic company','',$2::jsonb,'bookkeeping',now()+interval '1 hour')",
      [f.tenant, JSON.stringify({ iv: 'aWl2', tag: 'dGFn', data: 'ZGF0YQ==' })],
    )
    await f.db.query('select begin_fortnox_send($1,$2,$3)', [
      f.tenant,
      sendId,
      exportId,
    ])
    // No provider request. Leave the durable send pending, as after a lost response.
    for (let i = 0; i < 61; i++) {
      const laterClose = randomUUID()
      const laterItem = await f.item(`Synthetic later item ${i}`)
      await f.db.query(
        "select record_sale($1,$2,'manual',$3,('2021-01-01'::date+$4::integer)::timestamp at time zone 'Europe/Stockholm','SEK',$5::jsonb)",
        [
          f.tenant,
          randomUUID(),
          randomUUID(),
          i,
          JSON.stringify([{ itemId: laterItem, priceOre: 20000 }]),
        ],
      )
      await f.db.query(
        "select generate_day_close($1,$2,'2021-01-01'::date+$3::integer)",
        [f.tenant, laterClose, i],
      )
      await f.db.query('select export_day_close($1,$2,$3)', [
        f.tenant,
        randomUUID(),
        laterClose,
      ])
    }
    await f.commit()
    const overview =
      '/intake/accounting?view=reconciliation&from=2020-01-02&to=2020-01-02'
    await page.goto(overview)
    await expect(
      page.getByText(d.reconciliation.allDone, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(d.reconciliation.statuses.send_pending, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('link', { name: d.accounting.openExport, exact: true })
      .click()
    await expect(page).toHaveURL(`/intake/accounting/exports/${exportId}`)
    await expect(
      page.getByRole('link', { name: d.accounting.download, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.fortnox.sendVoucher, exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.fortnox.sendAgain, exact: true }),
    ).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('pending-export-mobile.png'),
      fullPage: true,
    })
    await page.getByText(d.fortnox.reconcileTitle, { exact: true }).click()
    const form = page.getByRole('form', {
      name: d.fortnox.reconcileTitle,
      exact: true,
    })
    await form.getByLabel(d.fortnox.reconcileSeries, { exact: true }).fill('A')
    await form.getByLabel(d.fortnox.reconcileNumber, { exact: true }).fill('42')
    await form.getByLabel(d.fortnox.reconcileYear, { exact: true }).fill('2020')
    await form
      .getByLabel(d.fortnox.reconcileEvidence, { exact: true })
      .fill('Local synthetic confirmation only')
    await form
      .getByRole('button', { name: d.fortnox.reconcileConfirm, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(
      `${d.fortnox.voucherSent} A42`,
    )
    await page.goto(overview)
    await expect(
      page.getByText(d.reconciliation.allDone, { exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from fortnox_voucher_sends where export_id=$1',
          [exportId],
        )
      ).rows[0].n,
    ).toBe(1)
    const otherContext = await browser.newContext()
    try {
      const otherPage = await otherContext.newPage(),
        otherEmail = `accounting-stranger-${randomUUID()}@example.test`
      await register(otherPage, otherEmail, `K!${randomUUID()}`)
      const other = await p2Fixture(otherEmail)
      try {
        await other.commit()
        await otherPage.goto(`/intake/accounting/exports/${exportId}`)
        await expect(
          otherPage.getByRole('heading', { name: d.notFound, exact: true }),
        ).toBeVisible()
      } finally {
        await other.close()
      }
    } finally {
      await otherContext.close()
    }
  } finally {
    await f.close()
  }
})
