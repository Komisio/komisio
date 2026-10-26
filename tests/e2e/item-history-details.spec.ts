import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('item history explains price, extension and end action on a narrow screen', async ({
  page,
}, testInfo) => {
  const email = `item-history-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic history jacket')
    const before = (
      await f.db.query(
        'select price_ore from item_prices where item_id=$1 order by seq desc limit 1',
        [item],
      )
    ).rows[0].price_ore
    await f.db.query(
      "select set_item_price($1,$2,$3,22000,'Synthetic price adjustment')",
      [f.tenant, randomUUID(), item],
    )
    await f.db.query(
      "select extend_sale_period($1,$2,$3,7,'Synthetic extension reason')",
      [f.tenant, randomUUID(), item],
    )
    await f.db.query(
      "select end_sale_period($1,$2,$3,'return','Synthetic <b>collection</b> note')",
      [f.tenant, randomUUID(), item],
    )
    await f.commit()
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto(`/intake/items/${item}`)
    await page
      .getByRole('tab', { name: d.itemDetail.history, exact: true })
      .click()
    const history = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: d.items.events }),
    })
    await history.locator(':scope > summary').click()
    await expect(history).toContainText(d.items.eventDetails.actions.return)
    await expect(history).toContainText('Synthetic <b>collection</b> note')
    await expect(history.locator('b')).toHaveCount(0)
    await expect(history).toContainText('Synthetic extension reason')
    await expect(history).toContainText(d.items.eventDetails.days)
    const money = (ore: number, currency: string) =>
      new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(
        ore / 100,
      )
    await expect(history).toContainText(
      `${money(Number(before), 'SEK')} → ${money(22000, 'SEK')}`,
    )
    await expect(history).toContainText('Synthetic price adjustment')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('item-history-details.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
