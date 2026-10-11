import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('large payout preparation stays within one hundred sellers and continues with the remainder', async ({
  page,
}) => {
  const email = `payout-large-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 105; i++) {
      const seller = (
        await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
          f.tenant,
          randomUUID(),
          `Synthetic batch ${String(i).padStart(3, '0')}`,
          '',
          `0709${String(i).padStart(6, '0')}`,
        ])
      ).rows[0].id
      await f.db.query('select adjust_seller_ledger($1,$2,$3,20000,$4)', [
        f.tenant,
        randomUUID(),
        seller,
        'Synthetic batch credit',
      ])
    }
    await f.commit()
    await page.goto('/intake/payouts#payouts-prepare')
    await page.setViewportSize({ width: 320, height: 800 })
    const batch = page.getByTestId('payout-settlement')
    await expect(
      batch.getByRole('button', {
        name: d.payouts.settle.replace('{count}', '100'),
        exact: true,
      }),
    ).toBeVisible()

    await expect(batch.locator('input[name="seller"]')).toHaveCount(25)
    const next = batch
      .getByRole('button', { name: d.sellersList.nextPage, exact: true })
      .first()
    const previous = batch
      .getByRole('button', { name: d.sellersList.previousPage, exact: true })
      .first()
    for (let i = 0; i < 4; i++) await next.click()
    await expect(batch.locator('input[name="seller"]')).toHaveCount(5)
    for (const checkbox of await batch.locator('input[name="seller"]').all())
      await expect(checkbox).toBeDisabled()
    await previous.click()
    const omitted = await batch
      .locator('input[name="seller"]')
      .last()
      .getAttribute('value')
    await batch.locator('input[name="seller"]').last().uncheck()
    await next.click()
    const included = await batch
      .locator('input[name="seller"]')
      .last()
      .getAttribute('value')
    await batch.locator('input[name="seller"]').last().check()
    await expect(
      batch.getByText(
        d.payouts.selectedCandidates
          .replace('{selected}', '100')
          .replace('{total}', '105'),
        { exact: true },
      ),
    ).toBeVisible()
    await batch
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('Synthetic first large batch')
    await batch.getByLabel(d.payouts.settleConfirm, { exact: true }).check()
    const waiting = page.waitForEvent('dialog')
    const leaving = page
      .getByRole('link', { name: d.payoutSheet.title, exact: true })
      .click()
    const dialog = await waiting
    expect(dialog.message()).toBe(d.leaveUnsaved)
    await dialog.dismiss()
    await leaving
    await expect(
      batch.getByLabel(d.payouts.settleReason, { exact: true }),
    ).toHaveValue('Synthetic first large batch')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: 'private/payout-large-mobile.png',
      fullPage: true,
    })
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'settlePayouts') return route.continue()
      commands.push(command)
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1)
        return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      return route.fulfill({ response })
    })
    await batch
      .getByRole('button', {
        name: d.payouts.settle.replace('{count}', '100'),
        exact: true,
      })
      .click()
    await expect(batch.getByRole('alert')).toHaveText(d.intake.failed)
    await expect(previous).toBeDisabled()
    await expect(
      batch.getByLabel(d.payouts.settleReason, { exact: true }),
    ).toBeDisabled()
    await batch
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(batch.getByRole('status')).toHaveText(d.payouts.settled)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    const selected = (commands[0].sellers as { sellerId: string }[]).map(
      (row) => row.sellerId,
    )
    expect(selected).toHaveLength(100)
    expect(selected).not.toContain(omitted)
    expect(selected).toContain(included)
    await batch
      .getByRole('button', { name: d.payouts.prepareMore, exact: true })
      .click()
    await expect(batch.locator('input[name="seller"]')).toHaveCount(5)
    await expect(batch.locator('input[name="seller"]:checked')).toHaveCount(5)
    await expect(
      batch.getByLabel(d.payouts.settleReason, { exact: true }),
    ).toHaveValue('')
    await expect(
      batch.getByLabel(d.payouts.settleConfirm, { exact: true }),
    ).not.toBeChecked()
    await batch
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('Synthetic remaining batch')
    await batch.getByLabel(d.payouts.settleConfirm, { exact: true }).check()
    await batch
      .getByRole('button', {
        name: d.payouts.settle.replace('{count}', '5'),
        exact: true,
      })
      .click()
    await expect(
      batch.getByText(d.payouts.settleEmpty, { exact: true }),
    ).toBeVisible()
    await expect(batch.getByRole('status')).toHaveText(d.payouts.settled)
    expect(commands).toHaveLength(3)
    expect(commands[2].requestId).not.toBe(commands[0].requestId)
    const rows = (
      await f.db.query(
        'select count(*)::int n,sum(amount_ore)::text total,count(paid_at)::int paid from payouts where tenant_id=$1 and status=$2',
        [f.tenant, 'approved'],
      )
    ).rows
    expect(rows).toEqual([{ n: 105, total: '2100000', paid: 0 }])
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
