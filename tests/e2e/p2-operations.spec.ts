import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('P2 proposals show their previews and require explicit approve or reject', async ({
  page,
}) => {
  test.setTimeout(180000)
  const email = `p2-operations-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const sold = await f.item('Return jacket'),
      markdown = await f.item('Markdown jacket'),
      bulk = await f.item('Bulk jacket')
    const sale = randomUUID(),
      payout = randomUUID(),
      close = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-01-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        sale,
        randomUUID(),
        JSON.stringify([{ itemId: sold, priceOre: 20000 }]),
      ],
    )
    const line = (
      await f.db.query('select id from sale_lines where sale_id=$1', [sale])
    ).rows[0].id
    await f.db.query('select adjust_seller_ledger($1,$2,$3,20000,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic opening balance',
    ])
    await f.db.query('select request_payout($1,$2,$3,10000)', [
      f.tenant,
      payout,
      f.seller,
    ])
    await f.db.query("select generate_day_close($1,$2,'2020-01-02')", [
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
    await f.commit()
    const agent = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [agent, `p2-agent-${agent}@example.test`],
    )
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'staff')",
      [f.tenant, agent],
    )
    async function propose(kind: string, payload: object) {
      const id = randomUUID()
      await f.asActor(agent, () =>
        f.db.query(
          "select propose_operation($1,$2,$3,$4::jsonb,$5,now()+interval '1 day')",
          [f.tenant, id, kind, JSON.stringify(payload), `Synthetic ${kind}`],
        ),
      )
      return id
    }
    const operations = [
      {
        kind: 'recordReturn',
        id: await propose('recordReturn', {
          saleLineId: line,
          refundOre: 20000,
          reason: 'Synthetic full return',
        }),
      },
      {
        kind: 'adjustLedger',
        id: await propose('adjustLedger', {
          sellerId: f.seller,
          amountOre: -500,
          reason: 'Synthetic correction',
        }),
      },
      {
        kind: 'applyMarkdownBatch',
        id: await propose('applyMarkdownBatch', {
          items: [{ itemId: markdown, step: 1 }],
        }),
      },
      {
        kind: 'bulkItemUpdate',
        id: await propose('bulkItemUpdate', {
          action: 'setPrice',
          reason: 'Synthetic price review',
          items: [{ itemId: bulk, priceOre: 17500 }],
        }),
      },
      {
        kind: 'approvePayout',
        id: await propose('approvePayout', {
          payoutId: payout,
          reason: 'Synthetic review',
        }),
      },
      {
        kind: 'sendMessage',
        id: await propose('sendMessage', {
          sellerId: f.seller,
          locale: 'sv',
          freeText: 'Synthetic message. No real delivery.',
        }),
      },
      {
        kind: 'exportDayClose',
        id: await propose('exportDayClose', { dayCloseId: close }),
      },
    ]
    const stale = await propose('approvePayout', {
      payoutId: payout,
      reason: 'Superseded proposal',
    })
    await page.goto('/intake/operations')
    for (const op of operations)
      await expect(
        page
          .getByRole('heading', {
            name: d.operations.kinds[
              op.kind as keyof typeof d.operations.kinds
            ],
            exact: true,
          })
          .first(),
      ).toBeVisible()
    async function approve(id: string, kind: string) {
      await page.goto(`/intake/operations/${id}`)
      await expect(
        page.getByRole('heading', {
          name: d.operations.kinds[kind as keyof typeof d.operations.kinds],
          exact: true,
        }),
      ).toBeVisible()
      if (kind === 'bulkItemUpdate') {
        const preview = page.getByRole('region', {
          name: d.operations.bulkPreview,
        })
        await expect(preview.getByRole('table')).toBeVisible()
        await expect(
          preview.getByText('175.00 SEK', { exact: true }),
        ).toBeVisible()
      }
      await page
        .getByLabel(d.operations.reason, { exact: true })
        .fill('Reviewed synthetic fixture')
      await page.getByLabel(d.operations.confirm, { exact: true }).check()
      await page
        .getByRole('button', { name: d.operations.approve, exact: true })
        .click()
      await expect(
        page.getByText(d.operations.status.executed, { exact: true }),
      ).toBeVisible()
      const result = (
        await f.db.query(
          'select outcome,decided_by from operation_decisions where operation_id=$1',
          [id],
        )
      ).rows[0]
      expect(result.outcome).toBe('executed')
      expect(result.decided_by).toBe(f.actor)
    }
    for (const op of operations) await approve(op.id, op.kind)
    await page.goto(`/intake/operations/${stale}`)
    await expect(
      page.getByText(d.operations.staleEngine, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.operations.approve, exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: d.operations.reject, exact: true })
      .click()
    await expect(
      page.getByText(d.operations.status.rejected, { exact: true }),
    ).toBeVisible()
    const payment = await propose('markPayoutPaid', {
      payoutId: payout,
      reference: 'SYNTHETIC ONLY',
      reason: 'Manual test fact',
    })
    await approve(payment, 'markPayoutPaid')
    expect(
      (await f.db.query('select status from payouts where id=$1', [payout]))
        .rows[0].status,
    ).toBe('paid')
    expect(
      Number(
        (
          await f.db.query(
            'select price_ore from item_prices where item_id=$1 order by seq desc limit 1',
            [markdown],
          )
        ).rows[0].price_ore,
      ),
    ).toBe(18000)
    expect(
      Number(
        (
          await f.db.query(
            'select price_ore from item_prices where item_id=$1 order by seq desc limit 1',
            [bulk],
          )
        ).rows[0].price_ore,
      ),
    ).toBe(17500)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sale_returns where sale_line_id=$1',
          [line],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_exports where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select status from seller_communications where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].status,
    ).not.toBe('queued')
  } finally {
    await f.close()
  }
})
