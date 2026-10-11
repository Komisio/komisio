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
    await page
      .getByRole('tab', { name: d.payouts.tabs.request, exact: true })
      .click()
    await request.getByLabel(d.payouts.amount, { exact: true }).fill('100,00')
    await page
      .getByRole('tab', { name: d.payouts.tabs.open, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.payouts.tabs.request, exact: true })
      .click()
    await expect(
      request.getByLabel(d.payouts.amount, { exact: true }),
    ).toHaveValue('100,00')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      expect(dialog.message()).toBe(d.leaveUnsaved)
      await dialog.dismiss()
    })
    await page
      .getByRole('link', { name: d.payoutSheet.title, exact: true })
      .click()
    await expect.poll(() => warnings).toBe(1)
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

test('a full-balance request keeps its confirmation after eligible sellers disappear', async ({
  page,
}) => {
  const email = `payout-full-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select adjust_seller_ledger($1,$2,$3,10000,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic full credit',
    ])
    await f.commit()
    await page.goto('/intake/payouts#payouts-request')
    const request = page.getByTestId('payout-request')
    await request.getByLabel(d.payouts.amount, { exact: true }).fill('100')
    await request.getByRole('checkbox').check()
    await request
      .getByRole('button', { name: d.payouts.request, exact: true })
      .click()
    await expect(
      request.getByText(d.payouts.requested, { exact: true }),
    ).toBeVisible()
    // A separate approval refreshes the mounted request form with no available credit.
    await page
      .getByRole('tab', { name: d.payouts.tabs.open, exact: true })
      .click()
    const open = page.getByTestId('payout-list')
    await open.locator('.payout-decision > summary').click()
    await open
      .getByRole('button', { name: d.payouts.approve, exact: true })
      .click()
    await expect(open.locator('.badge')).toHaveText(d.payouts.statuses.approved)
    await page
      .getByRole('tab', { name: d.payouts.tabs.request, exact: true })
      .click()
    await expect(
      request.getByText(d.payouts.requestNone, { exact: true }),
    ).toBeVisible()
    await expect(
      request.getByText(d.payouts.requested, { exact: true }),
    ).toBeVisible()
    await request
      .getByRole('link', { name: d.payouts.viewOpen, exact: true })
      .click()
    await expect(page.getByTestId('payout-list')).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from payouts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('a prepared batch keeps its result and explicitly starts the remaining sellers', async ({
  page,
}) => {
  const email = `payout-batch-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const other = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic second batch seller',
        '',
        '0709100000',
      ])
    ).rows[0].id
    for (const seller of [f.seller, other])
      await f.db.query('select adjust_seller_ledger($1,$2,$3,20000,$4)', [
        f.tenant,
        randomUUID(),
        seller,
        'Synthetic batch credit',
      ])
    await f.commit()
    await page.goto('/intake/payouts#payouts-prepare')
    const batch = page.getByTestId('payout-settlement')
    await batch.locator(`input[name="seller"][value="${other}"]`).uncheck()
    await batch
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('Synthetic first batch')
    await batch.getByLabel(d.payouts.settleConfirm, { exact: true }).check()
    await batch
      .getByRole('button', {
        name: d.payouts.settle.replace('{count}', '1'),
        exact: true,
      })
      .click()
    await expect(batch.getByRole('status')).toHaveText(d.payouts.settled)
    await expect(
      page.getByTestId('payout-list').locator('.payout-entry'),
    ).toHaveCount(1)
    await batch
      .getByRole('button', { name: d.payouts.prepareMore, exact: true })
      .click()
    await expect(batch.locator('input[name="seller"]')).toHaveCount(1)
    await expect(batch.locator(`input[value="${other}"]`)).toBeChecked()
    await batch
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('Synthetic second batch')
    await batch.getByLabel(d.payouts.settleConfirm, { exact: true }).check()
    await batch
      .getByRole('button', {
        name: d.payouts.settle.replace('{count}', '1'),
        exact: true,
      })
      .click()
    await expect(
      batch.getByText(d.payouts.settleEmpty, { exact: true }),
    ).toBeVisible()
    await expect(batch.getByRole('status')).toHaveText(d.payouts.settled)
    await batch
      .getByRole('link', { name: d.payouts.viewOpen, exact: true })
      .click()
    await expect(page.getByTestId('payout-list')).toBeVisible()
    const payouts = (
      await f.db.query(
        'select status,amount_ore,paid_at from payouts where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(payouts).toEqual([
      { status: 'approved', amount_ore: '20000', paid_at: null },
      { status: 'approved', amount_ore: '20000', paid_at: null },
    ])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from payout_batches where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
  } finally {
    await f.close()
  }
})
