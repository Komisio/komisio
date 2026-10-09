import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('payment sheet exports approved work without paying and records actual payment separately', async ({
  page,
}, testInfo) => {
  const email = `payment-sheet-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const payout = randomUUID()
  try {
    const item = await f.item('Synthetic payment sheet item')
    await f.db.query(
      "select record_sale($1,$2,'manual','payment-sheet-test',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 100000 }]),
      ],
    )
    await f.db.query('select request_payout($1,$2,$3,15001)', [
      f.tenant,
      payout,
      f.seller,
    ])
    await f.db.query('select approve_payout($1,$2,$3)', [
      f.tenant,
      randomUUID(),
      payout,
    ])
    await f.commit()
    await page.goto('/intake/payouts')
    await page
      .getByRole('link', { name: d.payoutSheet.title, exact: true })
      .click()
    await expect(page.locator('.payment-sheet-row')).toHaveCount(1)
    await expect(page.locator('.payment-sheet')).toContainText('150.01 SEK')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: d.payoutSheet.download }).click()
    const download = await downloadPromise
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv).toContain(payout)
    expect(csv).toContain('"150.01";"SEK"')
    expect(
      (await f.db.query('select status from payouts where id=$1', [payout]))
        .rows[0].status,
    ).toBe('approved')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('payment-sheet-mobile.png'),
      fullPage: true,
    })
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(
      page.getByRole('button', { name: d.payoutSheet.download }),
    ).toBeHidden()
    await expect(page.locator('.payment-sheet-summary')).toBeVisible()
    await page.emulateMedia({ media: 'screen' })
    const row = page.locator(`[data-payout="${payout}"]`)
    await row.locator('summary').click()
    await row
      .getByLabel(d.payouts.reference, { exact: true })
      .fill('SYNTHETIC-NO-TRANSFER')
    await row
      .getByRole('button', { name: d.payouts.markPaid, exact: true })
      .click()
    await expect(page.locator('.payment-sheet-row')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select status,payment_reference from payouts where id=$1',
          [payout],
        )
      ).rows[0],
    ).toEqual({ status: 'paid', payment_reference: 'SYNTHETIC-NO-TRANSFER' })
    await page.reload()
    await expect(
      page.getByText(d.payoutSheet.empty, { exact: true }),
    ).toBeVisible()
    await page.goto('/intake/payouts/payment-sheet?page=2')
    await expect(page).toHaveURL(/payment-sheet\?page=1$/)
    await expect(
      page.getByText(d.payoutSheet.empty, { exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
