import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff payout request retries the original amount after a committed response is lost', async ({
  page,
}) => {
  const email = `staff-payout-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select adjust_seller_ledger($1,$2,$3,50000,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic payout fixture',
    ])
    await f.commit()
    await page.goto('/intake/payouts')
    const request = page.getByTestId('payout-request')
    await request.locator('summary').click()
    await request.getByLabel(d.payouts.amount, { exact: true }).fill('100,00')
    await request.getByRole('checkbox').check()
    const payloads: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action !== 'requestPayout') return route.continue()
      payloads.push(payload)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (payloads.length === 1)
        await route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      else await route.fulfill({ response })
    })
    await request
      .getByRole('button', { name: d.payouts.request, exact: true })
      .click()
    await expect(request.getByRole('alert')).toHaveText(d.intake.failed)
    await expect(
      request.getByLabel(d.payouts.amount, { exact: true }),
    ).toBeDisabled()
    await request
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(request.getByRole('status')).toHaveText(d.payouts.requested)
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).toEqual(payloads[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from payouts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await request.getByLabel(d.payouts.amount, { exact: true }).fill('120')
    await expect(request.getByRole('status')).toHaveCount(0)
  } finally {
    await f.close()
  }
})
