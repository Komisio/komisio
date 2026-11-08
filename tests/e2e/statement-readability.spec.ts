import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('issued statements keep amounts readable on mobile and print only the document', async ({
  page,
}, testInfo) => {
  const email = `statement-readability-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic statement jacket')
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-01-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        'SYNTHETIC-STATEMENT',
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    const statement = randomUUID()
    await f.db.query('select adjust_seller_ledger($1,$2,$3,20000,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic opening adjustment',
    ])
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
      'Synthetic reserved payment',
    ])
    await f.db.query(
      "select issue_statement($1,$2,$3,'2020-01-01',clock_timestamp())",
      [f.tenant, statement, f.seller],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/statements/${statement}`)
    const document = page.locator('article.statement')
    await expect(document).toBeVisible()
    await expect(document).toHaveAttribute('lang', 'sv-SE')
    await expect(
      document
        .locator('.statement-totals > div')
        .filter({ hasText: d.statements.otherChanges }),
    ).toContainText(/[−-]100,00\s+kr/)
    await expect(
      document
        .locator('.statement-totals > div')
        .filter({ hasText: d.statements.closing }),
    ).toContainText(/180,00\s+kr/)
    const row = document.locator('tbody tr').first()
    await expect(row).toContainText(/200,00\s+kr/)
    await expect(row).toContainText(/120,00\s+kr/)
    await expect(row).toContainText(/80,00\s+kr/)
    await expect(document.locator('thead th')).toHaveCount(5)
    expect(
      await page.evaluate(
        () => window.document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    for (const amount of await row.locator('.statement-money').all()) {
      // A single-line amount must not be broken into digit fragments to fit the page.
      expect(
        await amount.evaluate((el) => getComputedStyle(el).whiteSpace),
      ).toBe('nowrap')
      const box = (await amount.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(320)
    }
    await page.screenshot({
      path: testInfo.outputPath('statement-mobile.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ media: 'print' })
    await expect(document).toBeVisible()
    await expect(page.locator('.sidebar')).not.toBeVisible()
    await expect(page.locator('.topbar')).not.toBeVisible()
    await expect(page.locator('.mobile-nav')).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: d.statements.print, exact: true }),
    ).not.toBeVisible()
    await expect(document.locator('thead')).toBeVisible()
    expect(await document.evaluate((el) => getComputedStyle(el).page)).toBe(
      'seller-statement',
    )
    expect((await document.boundingBox())!.x).toBeLessThanOrEqual(1)
    expect(
      await document
        .locator('thead')
        .evaluate((el) => getComputedStyle(el).display),
    ).toBe('table-header-group')
    await page.screenshot({
      path: testInfo.outputPath('statement-print.png'),
      fullPage: true,
    })
    await page.pdf({
      path: testInfo.outputPath('statement-a4.pdf'),
      preferCSSPageSize: true,
      printBackground: true,
    })
  } finally {
    await f.close()
  }
})
