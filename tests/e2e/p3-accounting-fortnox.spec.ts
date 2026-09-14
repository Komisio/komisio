import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The accounting page with the Fortnox slice, without any Fortnox
// configuration: the connection box names the missing binding, an export row
// carries its map version, a stored connection shows the company, and a send
// attempt is recorded as failed by the engine before any provider contact.
test('accounting page shows the Fortnox connection state and records a refused send', async ({
  page,
}) => {
  const email = `p3-fortnox-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic Fortnox jacket'),
      close = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-03-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.db.query("select generate_day_close($1,$2,'2020-03-02')", [
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
      randomUUID(),
      close,
    ])
    await f.commit()

    await page.goto('/intake/accounting?view=settings')
    const fortnox = page.getByRole('region', {
      name: d.fortnox.title,
      exact: true,
    })
    await expect(
      fortnox.getByText(d.fortnox.notConnected, { exact: true }),
    ).toBeVisible()
    await expect(
      fortnox.getByText(d.fortnox.connectionTenantMissing, { exact: true }),
    ).toBeVisible()
    await page.goto('/intake/accounting')
    const exports = page.getByRole('region', {
      name: d.accounting.exportsHeading,
      exact: true,
    })
    await expect(
      exports.getByText(`${d.accounting.mapVersion} 1`),
    ).toBeVisible()
    await expect(
      exports.getByText(d.fortnox.sendNeedsConnection, { exact: true }),
    ).toBeVisible()

    // A connection stored through the engine (ciphertext is opaque to the page).
    await f.asActor(f.actor, () =>
      f.db.query(
        "select store_fortnox_connection($1,'1751085','Komisio Test','',$2::jsonb,'bookkeeping',now()+interval '1 hour')",
        [
          f.tenant,
          JSON.stringify({ iv: 'aWl2', tag: 'dGFn', data: 'ZGF0YQ==' }),
        ],
      ),
    )
    await page.goto('/intake/accounting?view=settings')
    await expect(fortnox.getByText('Komisio Test').first()).toBeVisible()
    await expect(
      fortnox.getByText(`${d.fortnox.databaseNumber} 1751085`),
    ).toBeVisible()
    await expect(
      fortnox.getByText(d.fortnox.events.connected).first(),
    ).toBeVisible()
    await page.goto('/intake/accounting')

    // The send opens in the engine, fails on the missing configuration, and is recorded.
    await exports
      .getByRole('button', { name: d.fortnox.sendVoucher, exact: true })
      .click()
    await expect(exports.getByRole('alert')).toContainText(
      d.fortnox.errors.FORTNOX_NOT_CONNECTED,
    )
    const sends = (
      await f.db.query(
        'select status,error_code from fortnox_voucher_sends where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(sends).toEqual([
      { status: 'failed', error_code: 'FORTNOX_PREFLIGHT_FAILED' },
    ])
    await page.reload()
    await expect(exports.getByRole('alert')).toContainText(
      d.fortnox.errors.FORTNOX_PREFLIGHT_FAILED,
    )
    await expect(
      exports.getByRole('button', { name: d.fortnox.sendAgain, exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
