import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller economy keeps task drafts, keyboard navigation and bookmarked tasks on narrow screens', async ({
  page,
}, testInfo) => {
  const email = `economy-tabs-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select adjust_seller_ledger($1,$2,$3,69760,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic opening balance',
    ])
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
    const tabs = page.getByRole('tablist', {
      name: d.sellerWorkspace.economy,
      exact: true,
    })
    await expect(tabs.getByRole('tab')).toHaveCount(4)
    await expect(
      tabs.getByRole('tab', { name: d.payouts.title, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.seller-economy-available')).toContainText(
      /697,60\s+kr/,
    )
    await expect(page.locator('#statement-from')).not.toBeVisible()
    await tabs
      .getByRole('tab', { name: d.sellerProfile.transactions, exact: true })
      .click()
    await page.goBack()
    await expect(
      tabs.getByRole('tab', { name: d.payouts.title, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.economy, exact: true })
      .click()
    await expect(
      tabs.getByRole('tab', { name: d.payouts.title, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: testInfo.outputPath('economy-desktop.png'),
      fullPage: true,
    })
    await tabs
      .getByRole('tab', { name: d.ledger.adjustHeading, exact: true })
      .click()
    await page.locator('#ledger-amount').fill('-12,50')
    await page.locator('#ledger-reason').fill('Synthetic unsaved correction')
    await tabs
      .getByRole('tab', { name: d.statements.title, exact: true })
      .click()
    await page.locator('#statement-from').fill('2025-03-01')
    await page.locator('#statement-to').fill('2025-03-31')
    await tabs
      .getByRole('tab', { name: d.ledger.adjustHeading, exact: true })
      .click()
    await expect(page.locator('#ledger-amount')).toHaveValue('-12,50')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.economy, exact: true })
      .click()
    await expect(page.locator('#ledger-reason')).toHaveValue(
      'Synthetic unsaved correction',
    )
    await tabs
      .getByRole('tab', { name: d.ledger.adjustHeading, exact: true })
      .focus()
    await page.keyboard.press('ArrowLeft')
    await expect(
      tabs.getByRole('tab', { name: d.statements.title, exact: true }),
    ).toBeFocused()
    await expect(page.locator('#statement-from')).toHaveValue('2025-03-01')
    await expect(page).toHaveURL(/#seller-economy-statements$/)
    await page.goBack()
    await expect(
      tabs.getByRole('tab', { name: d.ledger.adjustHeading, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await tabs
        .getByRole('tab', { name: d.statements.title, exact: true })
        .click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`economy-${width}.png`),
        fullPage: true,
      })
    }
    await page.reload()
    await expect(
      tabs.getByRole('tab', { name: d.statements.title, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#statement-from')).toBeVisible()
    await page.goto(`/intake/sellers/${f.seller}#seller-ledger`)
    await expect(
      tabs.getByRole('tab', {
        name: d.sellerProfile.transactions,
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.economy, exact: true })
      .click()
    await expect(
      tabs.getByRole('tab', {
        name: d.sellerProfile.transactions,
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_ledger_entries where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from settlement_statements where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
