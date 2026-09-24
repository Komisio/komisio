import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff records a payout entirely on the selected seller page', async ({
  page,
}) => {
  const email = `seller-payout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic payout item')
    await f.db.query(
      "select record_sale($1,$2,'manual','seller-payout-test',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 100000 }]),
      ],
    )
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
    const section = page.locator('.seller-payouts')
    await section.locator('summary').click()
    await expect(
      section.getByLabel(d.payouts.seller, { exact: true }),
    ).toHaveValue(f.seller)
    await section.getByLabel(d.payouts.amount, { exact: true }).fill('150')
    await section.getByLabel(d.payouts.requestConfirm, { exact: true }).check()
    await section
      .getByRole('button', { name: d.payouts.request, exact: true })
      .click()
    await section
      .getByRole('button', { name: d.payouts.approve, exact: true })
      .click()
    await section
      .getByLabel(d.payouts.reference, { exact: true })
      .fill('SYNTHETIC-NO-BANK-TRANSFER')
    await section
      .getByRole('button', { name: d.payouts.markPaid, exact: true })
      .click()
    await expect(
      section.getByText('150.00 SEK · utbetald', { exact: true }),
    ).toBeVisible()
    const rows = (
      await f.db.query(
        'select seller_id,status,amount_ore,payment_reference from payouts where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].seller_id).toBe(f.seller)
    expect(rows[0].status).toBe('paid')
    expect(Number(rows[0].amount_ore)).toBe(15000)
    await page.reload()
    await section.locator('summary').click()
    await expect(
      section.getByText('150.00 SEK · utbetald', { exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
