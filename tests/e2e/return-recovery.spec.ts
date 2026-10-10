import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function prepare(page: Page, paid = false) {
  const email = `return-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic return recovery coat'),
      sale = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,now(),'SEK',$4::jsonb)",
      [
        f.tenant,
        sale,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: paid ? 50000 : 20000 }]),
      ],
    )
    const line = (
      await f.db.query(
        'select id,seller_credit_ore from sale_lines where sale_id=$1',
        [sale],
      )
    ).rows[0]
    const payout = paid ? randomUUID() : null
    if (payout) {
      await f.db.query('select request_payout($1,$2,$3,$4)', [
        f.tenant,
        payout,
        f.seller,
        line.seller_credit_ore,
      ])
      await f.db.query('select approve_payout($1,$2,$3)', [
        f.tenant,
        randomUUID(),
        payout,
      ])
      await f.db.query('select mark_payout_paid($1,$2,$3,$4)', [
        f.tenant,
        randomUUID(),
        payout,
        'Synthetic reference only',
      ])
    }
    await f.commit()
    await page.goto(`/intake/sales/${sale}`)
    await page.locator('.sale-return > summary').click()
    await page
      .getByLabel(d.returns.reason, { exact: true })
      .fill('Synthetic customer return')
    await page
      .getByLabel(
        d.returns.confirm.replace('{amount}', paid ? '500.00' : '200.00'),
        {
          exact: true,
        },
      )
      .check()
    return { f, line, payout }
  } catch (error) {
    await f.close()
    throw error
  }
}

test('a return handled in another session offers current facts instead of an endless retry', async ({
  page,
}) => {
  const { f, line } = await prepare(page)
  try {
    await f.asActor(f.actor, () =>
      f.db.query('select record_return($1,$2,$3,20000,$4)', [
        f.tenant,
        randomUUID(),
        line.id,
        'Already recorded in another session',
      ]),
    )
    await page
      .getByRole('button', { name: d.returns.record, exact: true })
      .click()
    await expect(page.locator('.sale-return').getByRole('alert')).toHaveText(
      d.intake.recordChanged,
    )
    await expect(
      page.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(
      'Already recorded in another session',
    )
    await expect(
      page.getByLabel(d.returns.reason, { exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sale_returns where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('an uncertain return response replays once and preserves the paid-seller review flag', async ({
  page,
}) => {
  const { f, line, payout } = await prepare(page, true)
  try {
    const sent: unknown[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/intake') && request.method() === 'POST')
        sent.push(request.postDataJSON())
    })
    await page.route(
      '**/api/intake',
      async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        await route.fulfill({
          status: 503,
          json: { error: 'LINE_ALREADY_RETURNED' },
        })
      },
      { times: 1 },
    )
    await page
      .getByRole('button', { name: d.returns.record, exact: true })
      .click()
    await expect(page.locator('.sale-return').getByRole('alert')).toHaveText(
      d.intake.failed,
    )
    await expect(
      page.getByLabel(d.returns.reason, { exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.returns.flagged)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    const returns = (
      await f.db.query(
        'select refund_ore,reason,flagged_for_review from sale_returns where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(returns).toEqual([
      {
        refund_ore: '50000',
        reason: 'Synthetic customer return',
        flagged_for_review: true,
      },
    ])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from seller_ledger_entries where tenant_id=$1 and kind='credit_reversal'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (await f.db.query('select status from payouts where id=$1', [payout]))
        .rows[0].status,
    ).toBe('paid')
    const available = await f.asActor(f.actor, async () => {
      const result = await f.db.query('select seller_balance($1,$2) b', [
        f.tenant,
        f.seller,
      ])
      return Number(result.rows[0].b.availableOre)
    })
    expect(available).toBe(-Number(line.seller_credit_ore))
  } finally {
    await f.close()
  }
})
