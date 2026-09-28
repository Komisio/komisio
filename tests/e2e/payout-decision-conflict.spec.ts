import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Two sessions of the same owner look at the same requested payout (a
// separate database session decides first; this is a concurrent-decision
// conflict, not a two-role authorization test). The browser session, still
// showing "requested", approves after the other session already did: the
// engine refuses, and the client must show the truth and offer a reload
// without a second reservation. Balance comes from the local ledger
// adjustment the seller-portal specs use; no sale, payment, provider, POS or
// e-mail is involved and no payout is ever marked paid.
test('an already approved payout is not re-reserved and the row recovers on the same page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const email = `payout-decision-conflict-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      f.seller,
      20000,
      'Synthetic conflict fixture',
    ])
    const payout = randomUUID()
    await f.db.query('select request_payout($1,$2,$3,$4)', [
      f.tenant,
      payout,
      f.seller,
      10000,
    ])
    await f.commit()
    await page.goto('/intake/payouts')
    const row = page.locator('.intake-notice').filter({
      has: page.locator(`#reason-${payout}`),
    })
    await expect(row).toContainText(d.payouts.statuses.requested)
    await row.locator(`#reason-${payout}`).fill('Synthetic browser approval')
    // The other session approves first.
    await f.asActor(f.actor, async () => {
      await f.db.query('select approve_payout($1,$2,$3,$4)', [
        f.tenant,
        randomUUID(),
        payout,
        'Synthetic concurrent approval',
      ])
    })
    let browserRequestId = ''
    const response = page.waitForResponse((r) => {
      if (!r.url().endsWith('/api/intake')) return false
      const body = r.request().postDataJSON()
      if (body?.action !== 'approvePayout') return false
      browserRequestId = body.requestId
      return true
    })
    await row
      .getByRole('button', { name: d.payouts.approve, exact: true })
      .click()
    const reply = await response
    expect(reply.status()).toBe(409)
    expect((await reply.json()).error).toBe('PAYOUT_NOT_REQUESTED')
    await expect(row.getByRole('alert')).toHaveText(d.intake.recordChanged)
    // The stale reason is no longer editable: only the reload is valid now.
    await expect(row.locator(`#reason-${payout}`)).toBeDisabled()
    for (const name of [d.payouts.approve, d.payouts.reject])
      await expect(
        row.getByRole('button', { name, exact: true }),
      ).toBeDisabled()
    // A way forward from the same page.
    const reload = row.getByRole('button', {
      name: d.intake.reload,
      exact: true,
    })
    await expect(reload).toBeVisible()
    await reload.click()
    await expect(page).toHaveURL(/\/intake\/payouts$/)
    const after = page.locator('.intake-notice').filter({
      has: page.locator(`#ref-${payout}`),
    })
    await expect(after).toContainText(d.payouts.statuses.approved)
    await expect(
      after.getByRole('button', { name: d.payouts.markPaid, exact: true }),
    ).toBeEnabled()
    await expect(after.getByRole('alert')).toHaveCount(0)
    // Invariants: one approval, one reservation, nothing paid.
    const state = (
      await f.db.query(
        'select status, approved_by, paid_at, payment_reference from payouts where tenant_id=$1 and id=$2',
        [f.tenant, payout],
      )
    ).rows[0]
    // payment_reference is a non-null text column that stays empty until paid.
    expect(state).toEqual({
      status: 'approved',
      approved_by: f.actor,
      paid_at: null,
      payment_reference: '',
    })
    const events = (
      await f.db.query(
        'select kind, id from payout_events where tenant_id=$1 and payout_id=$2 order by occurred_at, kind',
        [f.tenant, payout],
      )
    ).rows as { kind: string; id: string }[]
    expect(events.map((e) => e.kind)).toEqual(['requested', 'approved'])
    expect(browserRequestId).not.toBe('')
    expect(events.map((e) => e.id)).not.toContain(browserRequestId)
    const ledger = (
      await f.db.query(
        'select kind, amount_ore from seller_ledger_entries where tenant_id=$1 and seller_id=$2 order by kind',
        [f.tenant, f.seller],
      )
    ).rows
    expect(ledger).toEqual([
      { kind: 'adjustment', amount_ore: '20000' },
      { kind: 'payout_reserved', amount_ore: '-10000' },
    ])
    const balance = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select seller_balance($1,$2) b', [
            f.tenant,
            f.seller,
          ])
        ).rows[0].b,
    )
    expect(balance.reservedOre).toBe(10000)
    expect(balance.availableOre).toBe(10000)
    expect(balance.paidOre).toBe(0)
    const access = (
      await f.db.query(
        "select action, count(*)::int n from access_events where tenant_id=$1 and target_id=$2 and action like 'payout.%' group by action order by action",
        [f.tenant, payout],
      )
    ).rows
    expect(access).toEqual([
      { action: 'payout.approved', n: 1 },
      { action: 'payout.requested', n: 1 },
    ])
  } finally {
    await f.close()
  }
})
