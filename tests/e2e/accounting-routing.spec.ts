import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import messages from '../../messages/sv.json' with { type: 'json' }

test('accounting planning uses existing vouchers, stays unsaved and never sends financial requests', async ({
  page,
}, testInfo) => {
  const email = `routing-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const d = messages.accountingRouting
  try {
    const item = await f.item('Synthetic routing item')
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2026-09-30T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.db.query('select publish_accounting_map($1,$2,null,$3::jsonb)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({
        grossOre: { account: '1930', side: 'debit' },
        commissionOre: { account: '3010', side: 'credit' },
        sellerCreditOre: { account: '2890', side: 'credit' },
      }),
    ])
    await f.db.query('select generate_day_close($1,$2,$3)', [
      f.tenant,
      randomUUID(),
      '2026-09-30',
    ])
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    await page.getByRole('link', { name: d.simple.entry }).click()
    const section = page.getByRole('region', { name: d.title })
    await expect(section).toBeVisible()
    const checks = section.locator('.accounting-routing-checks')
    await expect(section.getByRole('radio')).toHaveCount(0)
    await expect(section.getByRole('status')).toContainText(
      d.simple.unknownHint,
    )
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.screenshot({
      path: testInfo.outputPath('setup-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: testInfo.outputPath('setup-mobile.png'),
      fullPage: true,
    })
    await section.getByText(d.simple.advanced, { exact: true }).click()
    const writes: string[] = []
    page.on('request', (request) => {
      if (
        request.method() !== 'GET' &&
        new URL(request.url()).pathname.startsWith('/api/')
      )
        writes.push(request.url())
    })
    await expect(section).toContainText(d.issues.externalUnknown)
    await section.getByLabel(d.externalLabel).selectOption('enabled')
    await expect(section.getByRole('status')).toContainText(d.simple.pos)
    await section
      .getByRole('radio', { name: d.modes.komisio.title, exact: false })
      .check()
    await expect(checks).toContainText(d.issues.duplicateSales)
    await section
      .getByRole('radio', { name: d.modes.pos.title, exact: false })
      .check()
    await expect(checks).toContainText(d.issues.complementUnavailable)
    await expect(checks).not.toContainText(d.issues.duplicateSales)
    await section.getByLabel(d.externalLabel).selectOption('disabled')
    await expect(section.getByRole('status')).toContainText(d.simple.komisio)
    await section
      .getByRole('radio', { name: d.modes.pos.title, exact: false })
      .check()
    await expect(checks).toContainText(d.issues.missingSales)
    await section.getByText(d.currentHeading, { exact: true }).click()
    await expect(section.getByLabel(d.closeLabel)).toContainText('2026-09-30')
    await expect(checks).not.toContainText(d.issues.unbalanced)
    // This existing three-account fixture balances, but leaves per-mode totals
    // unmapped. Planning must still surface that rather than imply readiness.
    await expect(checks).toContainText(d.issues.unmapped)
    await expect(section.getByText('200.00 SEK', { exact: true })).toHaveCount(
      2,
    )
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.screenshot({
      path: testInfo.outputPath('routing-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(section.getByLabel(d.externalLabel)).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('routing-mobile.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 740 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await section
      .getByRole('radio', { name: d.modes.manual.title, exact: false })
      .check()
    await expect(section.getByLabel(d.externalLabel)).toHaveValue('disabled')
    await expect(checks).toContainText(d.issues.manualReview)
    await expect(section.getByRole('button')).toHaveCount(0)
    expect(writes).toEqual([])
    await page.reload()
    await expect(section.locator('input[value=komisio]')).toBeChecked()
    await expect(section.getByLabel(d.externalLabel)).toHaveValue('unknown')
  } finally {
    await f.close()
  }
})
