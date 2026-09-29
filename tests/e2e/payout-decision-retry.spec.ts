import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Local synthetic facts only. Recording a paid fixture never transfers funds.
for (const c of [
  {
    action: 'approvePayout',
    before: 'requested',
    after: 'approved',
    button: d.payouts.approve,
  },
  {
    action: 'rejectPayout',
    before: 'requested',
    after: 'rejected',
    button: d.payouts.reject,
  },
  {
    action: 'markPayoutPaid',
    before: 'approved',
    after: 'paid',
    button: d.payouts.markPaid,
  },
  {
    action: 'rejectPayout',
    before: 'approved',
    after: 'rejected',
    button: d.payouts.reject,
  },
] as const)
  test(`unanswered ${c.action} from ${c.before} exposes only a retry of that decision`, async ({
    page,
  }) => {
    const email = `payout-retry-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        f.seller,
        20000,
        'Synthetic replay fixture',
      ])
      const payout = randomUUID()
      await f.db.query('select request_payout($1,$2,$3,$4)', [
        f.tenant,
        payout,
        f.seller,
        10000,
      ])
      if (c.before === 'approved')
        await f.db.query('select approve_payout($1,$2,$3,$4)', [
          f.tenant,
          randomUUID(),
          payout,
          'Synthetic prior approval',
        ])
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/intake/payouts')
      const row = page
        .locator('.intake-notice')
        .filter({ has: page.locator(`#reason-${payout}`) })
      await row.locator(`#reason-${payout}`).fill('Synthetic decision reason')
      if (c.action === 'markPayoutPaid')
        await row.locator(`#ref-${payout}`).fill('SYNTHETIC-NO-TRANSFER')
      const commands: Record<string, unknown>[] = []
      await page.route('**/api/intake', async (route) => {
        commands.push(route.request().postDataJSON())
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        if (commands.length === 1)
          await route.fulfill({
            status: 503,
            json: { error: 'REQUEST_FAILED' },
          })
        else await route.fulfill({ response })
      })
      await row.getByRole('button', { name: c.button, exact: true }).click()
      await expect(row.getByRole('alert')).toHaveText(d.intake.failed)
      await expect(row.locator(`#reason-${payout}`)).toBeDisabled()
      for (const name of [
        d.payouts.approve,
        d.payouts.reject,
        d.payouts.markPaid,
      ])
        await expect(
          row.getByRole('button', { name, exact: true }),
        ).toHaveCount(0)
      await expect(row.getByRole('button')).toHaveCount(1)
      const retryResponse = page.waitForResponse((response) => {
        if (!response.url().endsWith('/api/intake')) return false
        return (
          response.request().postDataJSON()?.requestId === commands[0].requestId
        )
      })
      await row
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      expect((await retryResponse).status()).toBe(200)
      await expect.poll(() => commands.length).toBe(2)
      expect(commands[0].action).toBe(c.action)
      expect(commands[1]).toEqual(commands[0])
      await expect
        .poll(
          async () =>
            (
              await f.db.query('select status from payouts where id=$1', [
                payout,
              ])
            ).rows[0].status,
        )
        .toBe(c.after)
      expect(
        (
          await f.db.query(
            'select count(*)::int n from payout_events where payout_id=$1 and id=$2 and kind=$3',
            [payout, commands[0].requestId, c.after],
          )
        ).rows[0].n,
      ).toBe(1)
      const state = (
        await f.db.query(
          'select paid_at,payment_reference from payouts where id=$1',
          [payout],
        )
      ).rows[0]
      if (c.after === 'paid')
        expect(state.payment_reference).toBe('SYNTHETIC-NO-TRANSFER')
      else expect(state).toEqual({ paid_at: null, payment_reference: '' })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    } finally {
      await f.close()
    }
  })
