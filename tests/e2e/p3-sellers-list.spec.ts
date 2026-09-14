import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The sellers list: search, counts and balance, and the link to the seller page.
test('the sellers list shows holdings and balance and opens the seller', async ({
  page,
}) => {
  const email = `p3-sellers-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
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
    await expect(row.getByRole('cell').nth(2)).toHaveText('2')
    await expect(row.getByRole('cell').nth(3)).toHaveText('1')
    await expect(row.getByRole('cell').nth(4)).toContainText('SEK')
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
  } finally {
    await f.close()
  }
})
