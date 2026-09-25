import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The sellers list: search, counts and balance, and the link to the seller page.
test('the sellers list shows holdings and balance and opens the seller', async ({
  page,
}, testInfo) => {
  const email = `p3-sellers-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query(
        'select name,email,phone from sellers where tenant_id=$1 and id=$2',
        [f.tenant, f.seller],
      )
    ).rows[0]
    await f.db.query('select save_seller_profile($1,$2,$3,0,$4::jsonb)', [
      f.tenant,
      randomUUID(),
      f.seller,
      JSON.stringify({
        ...seller,
        addressLine1: '',
        addressLine2: '',
        postalCode: '',
        city: '',
        country: '',
        language: '',
        notes: '',
        phone: '0700000000',
      }),
    ])
    const items = [await f.item('Listed jacket'), await f.item('Listed coat')]
    await f.db.query(
      "select record_sale($1,$2,'manual','L-1',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: items[0], priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.goto('/intake/sellers')
    const list = page.getByRole('region', {
      name: d.sellersList.title,
      exact: true,
    })
    const row = list.getByRole('row', { name: /Synthetic P2 seller/ })
    await expect(row).toBeVisible()
    await expect(row.getByRole('cell').nth(3)).toHaveText('2')
    await expect(row.getByRole('cell').nth(4)).toHaveText('1')
    await expect(row.getByRole('cell').nth(5)).toContainText('SEK')
    await expect(
      list.getByRole('columnheader', { name: d.intake.email, exact: true }),
    ).toBeVisible()
    await expect(
      list.getByRole('columnheader', { name: d.intake.phone, exact: true }),
    ).toBeVisible()
    await expect(row.locator('a[href="tel:0700000000"]')).toBeVisible()
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(52)
    await page.screenshot({
      path: testInfo.outputPath('seller-directory-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const searchBox = await list
      .getByLabel(d.sellersList.search, { exact: true })
      .boundingBox()
    const searchButton = await list
      .getByRole('button', { name: d.sellersList.searchButton, exact: true })
      .boundingBox()
    expect(Math.abs(searchBox!.y - searchButton!.y)).toBeLessThan(5)
    expect(
      (await row
        .getByRole('link', { name: 'Synthetic P2 seller', exact: true })
        .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44)
    await page.screenshot({
      path: testInfo.outputPath('seller-directory-mobile.png'),
      fullPage: true,
    })
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    const email = await row.locator('a[href^="mailto:"]').textContent()
    await list.getByLabel(d.sellersList.search, { exact: true }).fill(email!)
    await list
      .getByRole('button', { name: d.sellersList.searchButton, exact: true })
      .click()
    await expect(row).toBeVisible()
    await list
      .getByLabel(d.sellersList.search, { exact: true })
      .fill('nobody here')
    await list
      .getByRole('button', { name: d.sellersList.searchButton, exact: true })
      .click()
    await expect(
      page.getByText(d.sellersList.empty, { exact: true }),
    ).toBeVisible()
    await page.goto('/intake/sellers?q=synthetic')
    await list
      .getByRole('link', { name: 'Synthetic P2 seller', exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`/intake/sellers/${f.seller}`))
    await expect(
      page.getByRole('heading', { name: d.sellerProfile.balance, exact: true }),
    ).toBeVisible()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.terms, exact: true })
      .click()
    await expect(page.locator('#terms-rate')).not.toBeVisible()
    await page.getByText(d.sellerProfile.editTerms, { exact: true }).click()
    await expect(page.locator('#terms-rate')).toBeVisible()
    await page.getByText(d.sellerProfile.editTerms, { exact: true }).click()
    await page.screenshot({
      path: testInfo.outputPath('seller-overview-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('seller-overview-mobile.png'),
      fullPage: true,
    })
    await page
      .getByRole('tab', { name: d.sellerWorkspace.communication, exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: d.communications.send, exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
