import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('older stocktakes stay reachable without losing the open count', async ({
  page,
}, info) => {
  const email = `count-history-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids = []
    for (let i = 0; i < 22; i++) {
      const id = randomUUID()
      ids.push(id)
      await f.db.query('select start_stocktake($1,$2)', [f.tenant, id])
      await f.db.query(
        "select record_stocktake($1,$2,$3,'closed','',null,0,null,'')",
        [f.tenant, randomUUID(), id],
      )
    }
    const active = randomUUID()
    await f.db.query('select start_stocktake($1,$2)', [f.tenant, active])
    await f.commit()
    await page.goto('/intake/stocktake')
    await expect(page.getByLabel(d.stocktake.reference)).toBeVisible()
    const history = page.locator('.stocktake-session-history')
    await history.locator('summary').click()
    await expect(history.locator('li')).toHaveCount(20)
    const firstPage = await history
      .locator('li a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).href),
      )
    await page.getByLabel(d.stocktake.reference).fill('I-12345678')
    page.once('dialog', (dialog) => dialog.dismiss())
    await history
      .getByRole('link', { name: d.stocktake.next, exact: true })
      .click()
    await expect(page).not.toHaveURL(/historyPage=2/)
    await expect(page.getByLabel(d.stocktake.reference)).toHaveValue(
      'I-12345678',
    )
    await page.getByLabel(d.stocktake.reference).fill('')
    await history
      .getByRole('link', { name: d.stocktake.next, exact: true })
      .click()
    await expect(page).toHaveURL(/historyPage=2/)
    await expect(history.locator('li')).toHaveCount(3)
    await expect(page.getByLabel(d.stocktake.reference)).toBeVisible()
    const secondPage = await history
      .locator('li a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).href),
      )
    const all = [...firstPage, ...secondPage].map((href) =>
      new URL(href).searchParams.get('session'),
    )
    expect(new Set(all)).toEqual(new Set([...ids, active]))
    await history.locator('li a').last().click()
    await expect(
      page.getByRole('heading', { name: d.stocktake.closed, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.stocktake.exportAll, exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel(d.stocktake.reference)).toHaveCount(0)
    await expect(page).toHaveURL(/historyPage=2/)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: info.outputPath('stocktake-history-mobile.png'),
      fullPage: true,
    })
    await page
      .getByRole('link', { name: d.stocktake.open, exact: true })
      .click()
    await expect(page.getByLabel(d.stocktake.reference)).toBeVisible()
    await page.goto('/intake/stocktake?historyPage=999')
    await expect(page).toHaveURL(/historyPage=2/)
    await expect(history.locator('li')).toHaveCount(3)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from stocktake_events where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(22)
  } finally {
    await f.close()
  }
})
