import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('purchase sale-price drafts warn before paging and survive task tabs', async ({
  page,
}) => {
  const email = `acceptance-navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 21; i++)
      await f.db.query('select register_purchase($1,$2,$3,10000,$4,false)', [
        f.tenant,
        randomUUID(),
        `Synthetic price draft ${i}`,
        `Synthetic receipt ${i}`,
      ])
    await f.commit()
    await page.goto('/intake/purchases')
    const entry = page.locator('.purchase-entry').first()
    const price = entry.getByLabel(d.items.purchaseSalePrice, { exact: true })
    await price.fill('275')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      expect(dialog.message()).toBe(d.leaveUnsaved)
      await dialog.dismiss()
    })
    await page
      .getByRole('tab', { name: d.purchases.newPurchase, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.purchases.history, exact: true })
      .click()
    await expect(price).toHaveValue('275')
    expect(warnings).toBe(0)
    await page
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .first()
      .click()
    await expect.poll(() => warnings).toBe(1)
    await expect(page.locator('.purchase-entry')).toHaveCount(20)
    await expect(price).toHaveValue('275')
    await price.fill('')
    await page
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .first()
      .click()
    await expect(page.locator('.purchase-entry')).toHaveCount(1)
    expect(warnings).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
