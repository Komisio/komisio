import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('staff edits optional seller details without rewriting an issued statement', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  const email = `profile-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const statement = (
      await f.db.query(
        "select issue_statement($1,$2,$3,'2020-01-01','2020-02-01',null) id",
        [f.tenant, randomUUID(), f.seller],
      )
    ).rows[0].id
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-details`)
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    await page.locator('#seller-profile-name').fill('Updated synthetic seller')
    await page.locator('#seller-profile-phone').fill('0700000000')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.details, exact: true })
      .click()
    await expect(page.locator('#seller-profile-phone')).toHaveValue(
      '0700000000',
    )
    await page.getByText(d.sellerDetails.address, { exact: true }).click()
    await page
      .locator('#seller-profile-addressLine1')
      .fill('Synthetic Street 1')
    await page.locator('#seller-profile-postalCode').fill('12345')
    await page.locator('#seller-profile-city').fill('Test City')
    await page.locator('#seller-profile-country').fill('Sweden')
    await page.getByText(d.sellerDetails.preferences, { exact: true }).click()
    await page.locator('#seller-profile-language').selectOption('en')
    await page.locator('#seller-profile-notes').fill('Call before pickup')
    await page
      .getByRole('button', { name: d.sellerDetails.save, exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: 'Updated synthetic seller',
        exact: true,
      }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText('Synthetic Street 1, 12345 Test City, Sweden', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.seller-internal-note')).toContainText(
      'Call before pickup',
    )
    await page.screenshot({
      path: testInfo.outputPath('seller-profile-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    await expect(page.locator('#seller-profile-phone')).toHaveValue(
      '0700000000',
    )
    await page.screenshot({
      path: testInfo.outputPath('seller-profile-mobile.png'),
      fullPage: true,
    })
    await page.goto(`/intake/statements/${statement}`)
    await expect(page.locator('article.statement')).toContainText(
      'Synthetic P2 seller',
    )
    await expect(page.locator('article.statement')).not.toContainText(
      'Updated synthetic seller',
    )
    await expect(page.locator('article.statement')).not.toContainText(
      'Call before pickup',
    )
    expect(browserErrors).toEqual([])
  } finally {
    await f.close()
  }
})
