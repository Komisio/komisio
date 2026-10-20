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
    const firstPage = await history.locator('tbody tr').allTextContents()
    await history
      .getByRole('link', { name: d.ledger.older, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`ledgerPage=1#seller-economy$`))
    await expect(history).toHaveAttribute('open', '')
    await expect(history).toContainText(range(51, 51))
    const oldest = history.getByText(/Synthetic opening explanation/)
    await expect(oldest).toBeVisible()
    await expect(history.locator('tbody tr')).toContainText(/\+100,00\s+SEK/)
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
    expect(await history.locator('tbody tr').allTextContents()).toEqual(
      firstPage,
    )
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

test('seller account table shows sale shares and related payout events on desktop and mobile', async ({
  page,
}, testInfo) => {
  const email = `ledger-table-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item(
      'Synthetic ledger coat with a deliberately long descriptive name',
    )
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,now(),'SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 30000 }]),
      ],
    )
    const payout = randomUUID()
    await f.db.query('select request_payout($1,$2,$3,10000)', [
      f.tenant,
      payout,
      f.seller,
    ])
    await f.db.query('select approve_payout($1,$2,$3,$4)', [
      f.tenant,
      randomUUID(),
      payout,
      'Synthetic approval',
    ])
    await f.db.query('select mark_payout_paid($1,$2,$3,$4)', [
      f.tenant,
      randomUUID(),
      payout,
      'Synthetic bank reference',
    ])
    await f.commit()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/intake/sellers/${f.seller}?ledgerPage=0#seller-economy`)
    const history = page.locator('#seller-ledger')
    const table = history.getByRole('table', {
      name: d.sellerProfile.transactions,
    })
    await expect(table.getByRole('columnheader')).toHaveCount(7)
    await expect(table.locator('tbody tr')).toHaveCount(4)
    const sale = table
      .getByRole('row')
      .filter({ hasText: d.ledger.kinds.credit_sale })
    await expect(sale).toContainText(/300,00\s+SEK/)
    await expect(sale).toContainText(/180,00\s+SEK/)
    await expect(sale).toContainText(/120,00\s+SEK/)
    await expect(sale).toContainText(/\+120,00\s+SEK/)
    await expect(sale.getByRole('link')).toHaveAttribute(
      'href',
      `/intake/items/${item}`,
    )
    for (const kind of [
      'payout_reserved',
      'payout_paid',
      'payout_released',
    ] as const) {
      const row = table
        .getByRole('row')
        .filter({ hasText: d.ledger.kinds[kind] })
      await expect(row).toContainText(payout)
      await expect(row).toContainText(
        kind === 'payout_released' ? /\+100,00\s+SEK/ : /[−-]100,00\s+SEK/,
      )
    }
    await expect(history.locator('summary')).toContainText('4')
    await expect(
      page.getByText(d.ledger.adjustHeading, { exact: true }),
    ).toBeVisible()
    await table.screenshot({
      path: testInfo.outputPath('seller-ledger-desktop.png'),
    })
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 850 })
      await expect(sale.getByRole('link')).toBeVisible()
      expect(
        await sale
          .locator('td')
          .first()
          .evaluate((node) => getComputedStyle(node).display),
      ).toBe('grid')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await table.screenshot({
      path: testInfo.outputPath('seller-ledger-mobile.png'),
    })
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
    expect(Number(balance.availableOre)).toBe(2000)
    expect(Number(balance.paidOre)).toBe(10000)
    expect(balance.entries).toBe(4)
  } finally {
    await f.close()
  }
})
