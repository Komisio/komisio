import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('lifecycle origin restores filters and scroll; receipt and seller details retain nested origins after saving', async ({
  page,
}) => {
  const email = `return-navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 18; i++) await f.item(`Return position coat ${i}`)
    const sold = await f.item('Synthetic receipt origin coat')
    const sale = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual','RETURN-ORIGIN','2026-10-01T10:00:00Z','SEK',$3::jsonb)",
      [f.tenant, sale, JSON.stringify([{ itemId: sold, priceOre: 20000 }])],
    )
    await f.commit()
    await page.setViewportSize({ width: 1280, height: 720 })
    const origin = '/intake/lifecycle?q=Return&stage=markdown_due'
    await page.goto(origin)
    const rows = page.locator('.lifecycle-row')
    await expect(rows).toHaveCount(18)
    await rows.nth(8).getByRole('button').first().click()
    const links = page.locator('a[href^="/intake/items/"]:visible')
    await expect(links).toHaveCount(1)
    await links.last().scrollIntoViewIfNeeded()
    const y = await page.evaluate(() => window.scrollY)
    expect(y).toBeGreaterThan(300)
    const href = (await links.last().getAttribute('href'))!
    expect(new URL(href, page.url()).searchParams.get('returnTo')).toBe(origin)
    await links.last().click()
    await expect(
      page.getByRole('link', { name: d.returnNavigation.back, exact: true }),
    ).toHaveAttribute('href', origin)
    await page
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await expect(page).toHaveURL(new URL(origin, page.url()).href)
    await expect
      .poll(async () =>
        Math.abs((await page.evaluate(() => window.scrollY)) - y),
      )
      .toBeLessThan(5)
    await expect(
      page.getByLabel(d.lifecycle.search, { exact: true }),
    ).toHaveValue('Return')

    await page.goto('/intake/sales?reference=RETURN-ORIGIN&provider=manual')
    const receipts = page.url()
    await page.locator('.sales-register-row').click()
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/intake/sales/${sale}`)
    const receipt = page.url()
    await page.locator('.sale-line-item a').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic receipt origin coat',
    )
    await page
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await expect(page).toHaveURL(receipt)
    await expect(
      page.getByRole('link', { name: d.returnNavigation.back, exact: true }),
    ).toHaveAttribute(
      'href',
      new URL(receipts).pathname + new URL(receipts).search,
    )
    await page
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await expect(page).toHaveURL(receipts)

    await page.goto('/intake/sellers?q=Synthetic')
    const sellers = page.url()
    await page
      .locator(`main a[href^="/intake/sellers/${f.seller}?"]`)
      .first()
      .click()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.details, exact: true })
      .click()
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    await page.locator('#seller-profile-phone').fill('0700000000')
    await page
      .getByRole('button', { name: d.sellerDetails.save, exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: d.sellerDetails.saved }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: d.returnNavigation.back, exact: true }),
    ).toHaveAttribute(
      'href',
      new URL(sellers).pathname + new URL(sellers).search,
    )
    await page
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await expect(page).toHaveURL(sellers)
    await page.goto(
      `/intake/sales/${sale}?returnTo=${encodeURIComponent('//example.test')}`,
    )
    await expect(
      page.getByRole('link', { name: d.returnNavigation.back, exact: true }),
    ).toHaveAttribute('href', '/intake/sales')
  } finally {
    await f.close()
  }
})
