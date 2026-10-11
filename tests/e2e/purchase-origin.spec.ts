import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('a store-owned item opens its exact older purchase evidence and respects the active store', async ({
  page,
}) => {
  const email = `purchase-origin-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const evidence = 'SYNTHETIC-' + 'RECEIPT'.repeat(65)
    for (let n = 0; n < 23; n++)
      await f.db.query('select register_purchase($1,$2,$3,12345,$4,false)', [
        f.tenant,
        randomUUID(),
        `Synthetic original purchase ${n}`,
        evidence,
      ])
    const older = (
      await f.db.query(
        'select id,reference::text from purchase_receipts where tenant_id=$1 order by purchased_at desc,id offset 22 limit 1',
        [f.tenant],
      )
    ).rows[0]
    const item = randomUUID()
    await f.db.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
      f.tenant,
      item,
      older.id,
    ])
    const other = (
      await f.db.query('select create_tenant($1,$2,$3) id', [
        'Synthetic separate store',
        `purchase-private-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    const privateReceipt = randomUUID()
    await f.db.query('select register_purchase($1,$2,$3,10000,$4,false)', [
      other,
      privateReceipt,
      'PRIVATE OTHER PURCHASE',
      'PRIVATE OTHER EVIDENCE',
    ])
    await f.db.query('select set_active_tenant($1)', [f.tenant])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/items/${item}`)
    const origin = page.getByRole('link', {
      name: d.items.openOrigin,
      exact: true,
    })
    await expect(origin).toHaveAttribute(
      'href',
      `/intake/purchases/${older.id}`,
    )
    await origin.click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `${d.purchases.reference} P-${older.reference}`,
    )
    await expect(page.locator('.purchase-receipt')).toContainText('123.45 SEK')
    await expect(page.locator('.purchase-receipt')).toContainText(evidence)
    await expect(page.locator('.purchase-receipt')).toContainText(
      d.purchases.marginNo,
    )
    await expect(page.locator('.purchase-receipt time')).toHaveCount(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/purchase-origin-mobile.png',
      fullPage: true,
    })
    await page.getByRole('link', { name: d.items.open, exact: true }).click()
    await expect(page).toHaveURL(`/intake/items/${item}`)
    for (const id of [privateReceipt, randomUUID(), 'invalid-id']) {
      await page.goto(`/intake/purchases/${id}`)
      await expect(
        page.getByRole('heading', { name: d.notFound, exact: true }),
      ).toBeVisible()
      await expect(page.getByText('PRIVATE OTHER EVIDENCE')).toHaveCount(0)
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from purchase_receipts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(23)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
