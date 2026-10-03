import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('message choices identify every loaded item even while browsing an older item page', async ({
  page,
}) => {
  const email = `message-references-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const items: { id: string; title: string }[] = []
    for (let i = 0; i < 26; i++) {
      const title = `Synthetic reference item ${i}`
      items.push({ id: await f.item(title), title })
    }
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-03-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify(
          items
            .slice(0, 2)
            .map((item) => ({ itemId: item.id, priceOre: 20000 })),
        ),
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(
      `/intake/sellers/${f.seller}?itemsPage=1#seller-communication`,
    )
    const kind = page.getByLabel(d.communications.kind, { exact: true })
    await kind.selectOption('item_accepted')
    const reference = page.getByLabel(d.communications.reference, {
      exact: true,
    })
    await expect(reference.locator('option')).toHaveCount(26)
    for (const item of items)
      await expect(reference.locator(`option[value="${item.id}"]`)).toHaveText(
        `${item.title} · I-${item.id.slice(0, 8).toUpperCase()}`,
      )
    await kind.selectOption('item_sold')
    await expect(reference.locator('option')).toHaveCount(2)
    const sold = (
      await f.db.query(
        'select id,item_id from sale_lines where tenant_id=$1 order by item_id',
        [f.tenant],
      )
    ).rows
    for (const line of sold) {
      const item = items.find((item) => item.id === line.item_id)!
      await expect(reference.locator(`option[value="${line.id}"]`)).toHaveText(
        `${item.title} · I-${item.id.slice(0, 8).toUpperCase()} · ${d.sales.sellerCredit}: 80.00 SEK`,
      )
    }
    await reference.selectOption(sold[1].id)
    await page.getByLabel(d.communications.confirm, { exact: true }).check()
    let payload: Record<string, unknown> | null = null
    await page.route('**/api/communications', async (route) => {
      payload = route.request().postDataJSON()
      await route.fulfill({ status: 400, json: { error: 'INVALID_INPUT' } })
    })
    await page
      .getByRole('button', { name: d.communications.send, exact: true })
      .click()
    await expect(
      page.locator('form').filter({ has: kind }).getByRole('alert'),
    ).toHaveText(d.intake.invalid)
    expect(payload).toMatchObject({
      tenantId: f.tenant,
      sellerId: f.seller,
      kind: 'item_sold',
      referenceId: sold[1].id,
    })
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_communications where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})
