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
    await f.asActor(f.actor, () =>
      f.db.query("select record_fortnox_check($1,'refused',$2::jsonb)", [
        f.tenant,
        JSON.stringify({ reason: 'invalid_grant', revision: '1' }),
      ]),
    )
    await page.reload()
    await expect(
      fortnox.getByText(d.fortnox.errors.FORTNOX_REFRESH_INVALID_GRANT, {
        exact: false,
      }),
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
    const exportId = (
      await f.db.query('select id from accounting_exports where tenant_id=$1', [
        f.tenant,
      ])
    ).rows[0].id
    const sendId = randomUUID()
    await f.asActor(f.actor, async () => {
      await f.db.query('select begin_fortnox_send($1,$2,$3)', [
        f.tenant,
        sendId,
        exportId,
      ])
      await f.db.query(
        "select complete_fortnox_send($1,$2,'failed','',null,null,'FORTNOX_OUTCOME_UNKNOWN','')",
        [f.tenant, sendId],
      )
    })
    const confirmation = {
      action: 'confirmVoucher',
      tenantId: f.tenant,
      sendId,
      voucherSeries: 'A',
      voucherNumber: 42,
      financialYear: 2026,
      evidence: 'Synthetic owner compared company, date and all voucher lines',
    }
    const command = (data: object, origin = 'http://127.0.0.1:3000') =>
      page.request.post('/api/integrations/fortnox', {
        headers: { origin },
        data,
      })
    expect(
      (await command(confirmation, 'https://foreign.example')).status(),
    ).toBe(403)
    expect(
      (await command({ ...confirmation, tenantId: randomUUID() })).status(),
    ).toBe(409)
    expect((await command({ ...confirmation, evidence: '' })).status()).toBe(
      400,
    )
    expect(
      (
        await command({ ...confirmation, outcome: 'confirmed_absent' })
      ).status(),
    ).toBe(400)
    const backupOwner = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [backupOwner, `backup-${backupOwner}@example.test`],
    )
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
      [f.tenant, backupOwner],
    )
    for (const role of ['admin', 'staff']) {
      await f.asActor(backupOwner, () =>
        f.db.query('select change_member($1,$2,$3)', [f.tenant, f.actor, role]),
      )
      await page.reload()
      await expect(
        page.getByText(d.fortnox.reconcileTitle, { exact: true }),
      ).toHaveCount(0)
      expect((await command(confirmation)).status()).toBe(403)
    }
    await f.asActor(backupOwner, () =>
      f.db.query("select change_member($1,$2,'owner')", [f.tenant, f.actor]),
    )
    await page.reload()
    await expect(
      exports.getByRole('button', { name: d.fortnox.sendAgain, exact: true }),
    ).toHaveCount(0)
    await page.getByText(d.fortnox.reconcileTitle, { exact: true }).click()
    const form = page.getByRole('form', {
      name: d.fortnox.reconcileTitle,
      exact: true,
    })
    await expect(
      page.getByText(`${d.fortnox.databaseNumber}: 1751085`, { exact: true }),
    ).toBeVisible()
    await form.getByLabel(d.fortnox.reconcileSeries, { exact: true }).fill('A')
    await form.getByLabel(d.fortnox.reconcileNumber, { exact: true }).fill('42')
    await form.getByLabel(d.fortnox.reconcileYear, { exact: true }).fill('2026')
    await form
      .getByLabel(d.fortnox.reconcileEvidence, { exact: true })
      .fill(confirmation.evidence)
    await form
      .getByRole('button', { name: d.fortnox.reconcileConfirm, exact: true })
      .click()
    await expect(exports.getByRole('status')).toContainText(
      `${d.fortnox.voucherSent} A42`,
    )
    await expect(
      page.getByText(d.fortnox.reconcileTitle, { exact: true }),
    ).toHaveCount(0)
    expect((await command(confirmation)).status()).toBe(200)
    expect(
      (await command({ ...confirmation, voucherNumber: 43 })).status(),
    ).toBe(409)
    expect(
      (
        await f.db.query(
          "select count(*)::int count from access_events where tenant_id=$1 and action='fortnox.reconciled'",
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select status,reconciled_by,reconciliation_evidence from fortnox_voucher_sends where id=$1',
          [sendId],
        )
      ).rows[0],
    ).toEqual({
      status: 'sent',
      reconciled_by: f.actor,
      reconciliation_evidence: confirmation.evidence,
    })
  } finally {
    await f.close()
  }
})
