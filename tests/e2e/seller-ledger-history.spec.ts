import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff can reach older seller entries and keep the economy history open across paging', async ({
  page,
}, testInfo) => {
  const email = `ledger-history-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await f.asActor(f.actor, () =>
      f.db.query('select adjust_seller_ledger($1,$2,$3,10000,$4)', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic opening explanation',
      ]),
    )
    await f.asActor(f.actor, async () => {
      for (let index = 0; index < 50; index++)
        await f.db.query('select adjust_seller_ledger($1,$2,$3,100,$4)', [
          f.tenant,
          randomUUID(),
          f.seller,
          `Synthetic recent entry ${index}`,
        ])
    })
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
    const history = page.locator('#seller-ledger')
    await expect(history.locator('summary')).toContainText('51')
    await history.locator('summary').click()
    const range = (from: number, to: number) =>
      d.ledger.showingRange
        .replace('{from}', String(from))
        .replace('{to}', String(to))
        .replace('{total}', '51')
    await expect(history).toContainText(range(1, 50))
    await expect(history).not.toContainText('Synthetic opening explanation')
    const firstPage = await history
      .locator('.seller-disclosure-body > p')
      .allTextContents()
    await history
      .getByRole('link', { name: d.ledger.older, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`ledgerPage=1#seller-economy$`))
    await expect(history).toHaveAttribute('open', '')
    await expect(history).toContainText(range(51, 51))
    const oldest = history.getByText(/Synthetic opening explanation/)
    await expect(oldest).toBeVisible()
    await expect(oldest).toContainText('100.00 SEK')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    const recent = page
      .getByRole('tabpanel')
      .locator('.seller-workspace-list li')
    await expect(recent).toHaveCount(5)
    for (const entry of await recent.all())
      await expect(entry).toContainText('1.00 SEK')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.economy, exact: true })
      .click()
    await expect(oldest).toBeVisible()
    await expect(
      history.getByRole('link', { name: d.ledger.older, exact: true }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await history.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath('seller-ledger-older-mobile.png'),
      caret: 'initial',
    })
    await page.reload()
    await expect(history).toHaveAttribute('open', '')
    await expect(oldest).toBeVisible()
    await history
      .getByRole('link', { name: d.ledger.newer, exact: true })
      .click()
    await expect(history).toHaveAttribute('open', '')
    await expect(history).toContainText(range(1, 50))
    expect(
      await history.locator('.seller-disclosure-body > p').allTextContents(),
    ).toEqual(firstPage)
    await page.goto(`/intake/sellers/${f.seller}?ledgerPage=999#seller-economy`)
    await expect(history).toContainText(range(51, 51))
    await expect(oldest).toBeVisible()
    const balances = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select seller_balance($1,$2) b', [
            f.tenant,
            f.seller,
          ])
        ).rows[0].b,
    )
    expect(balances.entries).toBe(51)
    expect(Number(balances.availableOre)).toBe(15000)
  } finally {
    await f.close()
  }
})
