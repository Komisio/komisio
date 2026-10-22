import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const provider of ['fortnox', 'economic'] as const) {
  test(`${provider}: revised payout delivery shows only the additional payment and its reference`, async ({
    page,
  }) => {
    const email = `payout-delivery-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      const currency = provider === 'economic' ? 'DKK' : 'SEK'
      if (currency === 'DKK')
        await f.db.query(
          `select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy')||'{"currency":"DKK"}')`,
          [f.tenant, randomUUID()],
        )
      await f.db.query('select adjust_seller_ledger($1,$2,$3,100000,$4)', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic payout test',
      ])
      if (provider === 'fortnox') {
        await f.db.query(
          `select publish_accounting_map($1,$2,null,'{"payoutsPaidOre":{"account":"1930","side":"credit"},"payoutsPaidCounterpartOre":{"account":"2890","side":"debit"}}')`,
          [f.tenant, randomUUID()],
        )
        await f.db.query(
          `select store_fortnox_connection($1,'561','Synthetic','','{"iv":"a","tag":"b","data":"c"}','bookkeeping',now()+interval '1 hour')`,
          [f.tenant],
        )
      } else {
        await f.db.query(
          `select store_economic_connection($1,123456,'Synthetic','','DKK','{"iv":"a","tag":"b","data":"c"}')`,
          [f.tenant],
        )
        await f.db.query(
          `select publish_economic_map($1,$2,null,123456,1,'{"payoutsPaidOre":{"account":"1930","side":"credit","vatCode":"Z0"},"payoutsPaidCounterpartOre":{"account":"2890","side":"debit","vatCode":"Z0"}}')`,
          [f.tenant, randomUUID()],
        )
      }
      let exportId = ''
      let baselineSendId = ''
      for (const [index, amount] of [12345, 23456].entries()) {
        const payoutId = randomUUID()
        await f.db.query('select request_payout($1,$2,$3,$4)', [
          f.tenant,
          payoutId,
          f.seller,
          amount,
        ])
        await f.db.query('select approve_payout($1,$2,$3)', [
          f.tenant,
          randomUUID(),
          payoutId,
        ])
        await f.db.query('select confirm_payout_payments($1,$2,$3,$4)', [
          f.tenant,
          randomUUID(),
          currency,
          JSON.stringify([
            { payoutId, amountOre: amount, reference: `BANK-${index + 1}` },
          ]),
        ])
        const close = (
          await f.db.query(
            "select generate_day_close($1,$2,(now() at time zone 'Europe/Stockholm')::date) id",
            [f.tenant, randomUUID()],
          )
        ).rows[0].id
        exportId = (
          await f.db.query(
            `select ${provider === 'economic' ? 'export_economic_day_close' : 'export_day_close'}($1,$2,$3) id`,
            [f.tenant, randomUUID(), close],
          )
        ).rows[0].id
        if (index === 0) {
          // Synthetic confirmation exercises the same frozen baseline as the connector;
          // no request is sent to an external accounting system in this test.
          const send = randomUUID()
          baselineSendId = send
          await f.db.query(`select begin_${provider}_send($1,$2,$3)`, [
            f.tenant,
            send,
            exportId,
          ])
          await f.db.query(
            provider === 'economic'
              ? "select complete_economic_send($1,$2,'sent',42,'','',null)"
              : "select complete_fortnox_send($1,$2,'sent','A',42,2026,'','')",
            [f.tenant, send],
          )
        }
      }
      await f.commit()
      await page.goto(
        provider === 'fortnox'
          ? `/intake/accounting/exports/${exportId}`
          : `/intake/accounting?view=exports&destination=economic&export=${exportId}`,
      )
      if (provider === 'fortnox')
        await page
          .getByRole('button', { name: d.fortnox.reviewDelivery, exact: true })
          .click()
      const preview =
        provider === 'fortnox'
          ? page.locator('.fortnox-send-status')
          : page
              .locator('article')
              .filter({
                has: page.getByRole('link', {
                  name: d.accounting.openExport,
                  exact: true,
                }),
              })
              .first()
      await expect(
        preview.getByText(`234.56 ${currency}`, { exact: true }),
      ).toHaveCount(2)
      const evidence = preview
        .locator('details')
        .filter({
          has: page.locator('summary', {
            hasText: d.accounting.payoutEvidence.title,
          }),
        })
        .last()
      await evidence.locator('summary').click()
      await expect(evidence).toContainText('BANK-2')
      await expect(evidence).not.toContainText('BANK-1')
      await page.setViewportSize({ width: 390, height: 844 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: `test-results/payout-${provider}.png`,
        fullPage: true,
      })
      if (provider === 'fortnox') {
        const send = randomUUID()
        await f.asActor(f.actor, async () => {
          await f.db.query('select begin_fortnox_send($1,$2,$3,$4)', [
            f.tenant,
            send,
            exportId,
            baselineSendId,
          ])
        })
        await page.reload()
        await expect(preview).toContainText(
          d.fortnox.errors.FORTNOX_SEND_IN_PROGRESS,
        )
        await expect(
          preview.getByText('234.56 SEK', { exact: true }),
        ).toHaveCount(2)
        await evidence.locator('summary').click()
        await expect(evidence).toContainText('BANK-2')
        await expect(evidence).not.toContainText('BANK-1')
        await f.asActor(f.actor, async () => {
          await f.db.query(
            "select complete_fortnox_send($1,$2,'sent','A',43,2026,'','')",
            [f.tenant, send],
          )
        })
        await page.reload()
        await expect(preview.getByRole('status')).toContainText('A43')
        await preview
          .locator('summary', { hasText: d.fortnox.reviewDelivery })
          .click()
        await evidence.locator('summary').click()
        await expect(evidence).toContainText('BANK-2')
        await expect(evidence).not.toContainText('BANK-1')
        await expect(
          preview.getByRole('button', {
            name: d.fortnox.sendVoucher,
            exact: true,
          }),
        ).toHaveCount(0)
      }
    } finally {
      await f.close()
    }
  })
}
