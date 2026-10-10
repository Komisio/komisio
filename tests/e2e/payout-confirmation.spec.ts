import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function prepare(page: Page) {
  const email = `payout-confirmation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const ids = [randomUUID(), randomUUID()]
  try {
    await f.db.query(
      "select adjust_seller_ledger($1,$2,$3,100000,'Synthetic browser balance')",
      [f.tenant, randomUUID(), f.seller],
    )
    for (const id of ids) {
      await f.db.query('select request_payout($1,$2,$3,15001)', [
        f.tenant,
        id,
        f.seller,
      ])
      await f.db.query('select approve_payout($1,$2,$3)', [
        f.tenant,
        randomUUID(),
        id,
      ])
    }
    await f.commit()
    await page.goto('/intake/payouts/payment-sheet')
    await page
      .getByRole('checkbox', { name: d.payoutSheet.selectAll, exact: true })
      .check()
    for (const [index, id] of ids.entries()) {
      await page
        .locator(`[data-payout="${id}"]`)
        .getByLabel(d.payouts.reference, { exact: true })
        .fill(`SYNTHETIC-BANK-${index + 1}`)
    }
    return { f, ids }
  } catch (error) {
    await f.close()
    throw error
  }
}

test('staff confirms completed payments together and a lost response retries the same batch', async ({
  page,
}, testInfo) => {
  const { f, ids } = await prepare(page)
  try {
    await expect(page.locator('.payment-sheet-confirmation')).toContainText(
      '300.02 SEK',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('payment-confirmation-mobile.png'),
      fullPage: true,
    })
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.payment-sheet-confirmation')).toBeHidden()
    await expect(
      page.getByRole('checkbox', { name: d.payoutSheet.selectAll }),
    ).toBeHidden()
    await expect(page.locator('.payment-sheet-summary').first()).toBeVisible()
    await page.emulateMedia({ media: 'screen' })
    const submitted: unknown[] = []
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/intake') &&
        request.postDataJSON()?.action === 'confirmPayoutPayments'
      )
        submitted.push(request.postDataJSON())
    })
    await page.route(
      '**/api/intake',
      async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        await route.abort('failed')
      },
      { times: 1 },
    )
    await page
      .getByRole('button', { name: d.payoutSheet.confirmSelected, exact: true })
      .click()
    await expect(
      page.locator('.payment-sheet-confirmation').getByRole('alert'),
    ).toHaveText(d.intake.failed)
    await expect(
      page.getByRole('checkbox', { name: d.payoutSheet.selectAll }),
    ).toBeDisabled()
    await expect(
      page
        .locator(`[data-payout="${ids[0]}"]`)
        .getByLabel(d.payouts.reference, { exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page.locator('.payment-sheet-row')).toHaveCount(0)
    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toEqual(submitted[0])
    const payments = (
      await f.db.query(
        'select id,status,payment_reference from payouts where id=any($1::uuid[])',
        [ids],
      )
    ).rows
    for (const [index, id] of ids.entries()) {
      expect(payments.find((row: { id: string }) => row.id === id)).toEqual({
        id,
        status: 'paid',
        payment_reference: `SYNTHETIC-BANK-${index + 1}`,
      })
    }
    expect(
      (
        await f.db.query(
          "select count(*)::int n from seller_ledger_entries where tenant_id=$1 and kind='payout_paid'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='payout.payments_confirmed'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('a changed payment stops the entire batch and offers current data', async ({
  page,
}) => {
  const { f, ids } = await prepare(page)
  try {
    await f.asActor(f.actor, () =>
      f.db.query(
        "select reject_payout($1,$2,$3,'Synthetic change from another staff session')",
        [f.tenant, randomUUID(), ids[0]],
      ),
    )
    await page
      .getByRole('button', { name: d.payoutSheet.confirmSelected, exact: true })
      .click()
    await expect(
      page.locator('.payment-sheet-confirmation').getByRole('alert'),
    ).toHaveText(d.intake.recordChanged)
    await expect(
      page.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    expect(
      (await f.db.query('select status from payouts where id=$1', [ids[1]]))
        .rows[0].status,
    ).toBe('approved')
    expect(
      (
        await f.db.query(
          "select count(*)::int n from seller_ledger_entries where tenant_id=$1 and kind='payout_paid'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(page.locator('.payment-sheet-row')).toHaveCount(1)
    await expect(page.locator('.payment-sheet-confirmation')).toBeHidden()
  } finally {
    await f.close()
  }
})
