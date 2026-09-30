import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller workspace distinguishes actual sale price from list price through return and resale', async ({
  page,
}, testInfo) => {
  const email = `workspace-price-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const sold = await f.item('Synthetic sold coat')
    await f.item('Synthetic unsold lamp')
    const sale = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual','synthetic-workspace-price',now(),'SEK',$3::jsonb)",
      [f.tenant, sale, JSON.stringify([{ itemId: sold, priceOre: 15000 }])],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/sellers/${f.seller}#seller-items`)
    const panel = page.getByRole('tabpanel')
    const row = panel.locator('li').filter({ hasText: 'Synthetic sold coat' })
    const unsold = panel
      .locator('li')
      .filter({ hasText: 'Synthetic unsold lamp' })
    await expect(row).toContainText(d.lifecycle.stages.sold)
    await expect(row).toContainText(d.items.acceptedAt + ':')
    await expect(row.locator('strong')).toHaveText('150.00 SEK')
    await expect(unsold.locator('strong')).toHaveText('200.00 SEK')
    await expect(unsold).toContainText(d.lifecycle.stages.markdown_due)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath('seller-sale-price-mobile.png'),
      caret: 'initial',
    })
    await f.asActor(f.actor, async () => {
      const line = (
        await f.db.query(
          'select id from sale_lines where tenant_id=$1 and sale_id=$2',
          [f.tenant, sale],
        )
      ).rows[0].id
      await f.db.query('select record_return($1,$2,$3,15000,$4)', [
        f.tenant,
        randomUUID(),
        line,
        'Synthetic full return',
      ])
    })
    await page.reload()
    await expect(row).toContainText(d.lifecycle.stages.markdown_due)
    await expect(row.locator('strong')).toHaveText('200.00 SEK')
    await f.asActor(f.actor, async () => {
      await f.db.query(
        "select record_sale($1,$2,'manual','synthetic-workspace-resale',now(),'SEK',$3::jsonb)",
        [
          f.tenant,
          randomUUID(),
          JSON.stringify([{ itemId: sold, priceOre: 17000 }]),
        ],
      )
    })
    await page.reload()
    await expect(row).toContainText(d.lifecycle.stages.sold)
    await expect(row.locator('strong')).toHaveText('170.00 SEK')
    await expect(unsold.locator('strong')).toHaveText('200.00 SEK')
    await row.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/intake/items/${sold}$`))
  } finally {
    await f.close()
  }
})
