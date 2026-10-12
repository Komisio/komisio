import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('concurrent refund delivery reverses once, links the original sale and holds partial returns', async ({
  page,
}) => {
  const email = `refund-owner-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const { Client } = createRequire(import.meta.url)('pg')
  const other = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await other.connect()
  try {
    const items = [
      await f.item('Synthetic returned jacket'),
      await f.item('Synthetic held jacket'),
    ]
    await f.db.query('select publish_zettle_catalog_config($1,$2,null,$3)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({ consignment_margin: 0 }),
    ])
    for (const item of items)
      await f.db.query('select prepare_zettle_product($1,$2)', [f.tenant, item])
    const exports = (
      await f.db.query(
        'select item_id,product_id,variant_id from zettle_product_exports where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    const lines = items.map((item, i) => {
      const e = exports.find((e: { item_id: string }) => e.item_id === item)
      return {
        lineNo: i + 1,
        reference: null,
        labelConflict: false,
        description: `Synthetic line ${i + 1}`,
        priceOre: 20000,
        productUuid: e.product_id,
        variantUuid: e.variant_id,
      }
    })
    const original = {
      externalId: randomUUID(),
      occurredAt: new Date(Date.now() - 60000).toISOString(),
      currency: 'SEK',
      amountOre: 40000,
      blockedReason: null,
      lines,
    }
    await f.db.query('select record_zettle_page($1,$2,null,$3,$4)', [
      f.tenant,
      randomUUID(),
      'original',
      JSON.stringify([original]),
    ])
    await f.commit()
    const refund = {
      ...original,
      externalId: randomUUID(),
      refundOf: original.externalId,
      occurredAt: new Date().toISOString(),
      amountOre: -20000,
      blockedReason: 'refund',
      lines: [lines[0]],
    }
    const claims = JSON.stringify({ sub: f.actor, role: 'authenticated' })
    for (const db of [f.db, other]) {
      await db.query('begin')
      await db.query('set local role authenticated')
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        claims,
      ])
    }
    const args = [
      f.tenant,
      randomUUID(),
      'original',
      'refund',
      JSON.stringify([refund]),
    ]
    await f.db.query('select record_zettle_page($1,$2,$3,$4,$5)', args)
    const competing = other.query(
      'select record_zettle_page($1,$2,$3,$4,$5) id',
      args,
    )
    await f.commit()
    expect((await competing).rows[0].id).toBe(args[1])
    await other.query('commit')
    expect(
      (
        await f.db.query(
          'select count(*) from sale_returns where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe('1')
    expect(
      (
        await f.db.query(
          "select count(*) from seller_ledger_entries where tenant_id=$1 and kind='credit_reversal'",
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe('1')
    const imported = (
      await f.db.query(
        'select id from zettle_imports where tenant_id=$1 and external_id=$2',
        [f.tenant, refund.externalId],
      )
    ).rows[0].id
    await page.goto(`/intake/integrations/${imported}`)
    await expect(
      page.getByRole('heading', {
        name: d.zettle.returns.receipt,
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(d.zettle.returns.recorded, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: d.zettle.returns.original }),
    ).toHaveAttribute('href', /\/intake\/sales\/[\da-f-]+$/)
    await expect(
      page.getByRole('button', { name: d.zettle.returns.retry }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.zettle.match, exact: true }),
    ).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/paypal-return-mobile.png',
      fullPage: true,
    })
    const partial = {
      ...refund,
      externalId: randomUUID(),
      amountOre: -10000,
      lines: [{ ...lines[1], lineNo: 1, priceOre: 10000 }],
    }
    await f.asActor(f.actor, () =>
      f.db.query('select record_zettle_page($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'refund',
        'partial',
        JSON.stringify([partial]),
      ]),
    )
    const held = (
      await f.db.query(
        'select id from zettle_imports where tenant_id=$1 and external_id=$2',
        [f.tenant, partial.externalId],
      )
    ).rows[0].id
    await page.goto(`/intake/integrations/${held}`)
    await expect(
      page.getByText(d.zettle.errors.PARTIAL_REFUND_UNSUPPORTED, {
        exact: true,
      }),
    ).toBeVisible()
    await page.getByRole('button', { name: d.zettle.returns.retry }).click()
    await expect(page.getByText(d.zettle.done, { exact: true })).toBeVisible()
    await expect(
      page.getByText(d.zettle.errors.PARTIAL_REFUND_UNSUPPORTED, {
        exact: true,
      }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*) from sale_returns where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].count,
    ).toBe('1')
  } finally {
    await other.query('rollback')
    await other.end()
    await f.close()
  }
})
