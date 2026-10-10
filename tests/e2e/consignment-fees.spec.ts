import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store configures fee VAT, seller months cover multiple deliveries, and payments remain visible to sellers', async ({
  page,
}) => {
  const email = `monthly-fees-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings#policy-section-period')
    await page
      .getByLabel(d.storePolicy.consignmentCalendarEnabled, { exact: true })
      .check()
    await page.getByLabel(d.consignmentFees.enabled, { exact: true }).check()
    await page
      .getByLabel(d.consignmentFees.amount, { exact: true })
      .fill('100,01')
    await page
      .getByLabel(d.consignmentFees.vatBasis, { exact: true })
      .selectOption('exclusive')
    await page.getByLabel(d.consignmentFees.vatRate, { exact: true }).fill('25')
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'publishStorePolicy',
    )
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    const response = await saved
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON().policy.consignmentPeriod).toEqual({
      months: 3,
      collectionDays: 2,
      monthlyFee: {
        amountOre: 10001,
        vatBasis: 'exclusive',
        vatRatePercent: 25,
        collection: 'balance',
      },
    })
    await page.reload()
    await expect(
      page.getByLabel(d.consignmentFees.amount, { exact: true }),
    ).toHaveValue('100.01')
    await f.asActor(f.actor, async () => {
      await f.item('First monthly coat')
      await f.item('Second monthly coat')
    })
    await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
    const history = page.locator('#consignment-fees')
    await expect(history.getByRole('article')).toHaveCount(1)
    await expect(history).toContainText('125.01 SEK')
    await expect(history).toContainText(d.consignmentFees.status.deducted)
    await history
      .getByText(d.consignmentFees.reverse, { exact: true })
      .first()
      .click()
    await history
      .getByLabel(d.consignmentFees.reason, { exact: true })
      .fill('Synthetic correction')
    await history
      .getByLabel(d.consignmentFees.confirmReversal, { exact: true })
      .check()
    await history
      .getByRole('button', { name: d.consignmentFees.reverse, exact: true })
      .click()
    await expect(history).toContainText(d.consignmentFees.status.reversed)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
    await page.screenshot({
      path: 'private/monthly-fees-staff.png',
      fullPage: true,
    })

    const seller = await f.asActor(f.actor, async () => {
      await f.db.query(
        `select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,jsonb_set(current_store_policy($1)->'policy','{consignmentPeriod,monthlyFee,collection}','"separate"'))`,
        [f.tenant, randomUUID()],
      )
      const seller = (
        await f.db.query(
          "select register_seller($1,$2,'Portal fee seller',$3,'') id",
          [f.tenant, randomUUID(), email],
        )
      ).rows[0].id
      await f.db.query(
        "select receive_bag_with_agreement($1,$2,$3,'Separate fee receipt',$4)",
        [f.tenant, randomUUID(), seller, f.agreement],
      )
      return seller
    })
    await page.goto(`/intake/sellers/${seller}#seller-economy`)
    await expect(history).toContainText(d.consignmentFees.status.unpaid)
    await history
      .getByText(d.consignmentFees.pay, { exact: true })
      .first()
      .click()
    await history
      .getByLabel(d.consignmentFees.reference, { exact: true })
      .fill('SYNTHETIC-POS-123')
    await history
      .getByLabel(d.consignmentFees.confirmPayment, { exact: true })
      .check()
    await history
      .getByRole('button', { name: d.consignmentFees.pay, exact: true })
      .click()
    await expect(history).toContainText(d.consignmentFees.status.paid)
    await page.goto(`/seller?seller=${seller}`)
    await expect(history).toContainText('125.01 SEK')
    await expect(history).toContainText(d.consignmentFees.status.paid)
    await expect(history).not.toContainText('SYNTHETIC-POS-123')
    await expect(history.getByRole('button')).toHaveCount(0)
    await page.screenshot({
      path: 'private/monthly-fees-seller.png',
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
