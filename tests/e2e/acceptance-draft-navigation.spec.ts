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

test('switching inspection origins warns and starts a fresh sale-price form', async ({
  page,
}) => {
  const email = `acceptance-origin-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic acceptance bag',
        f.agreement,
      ])
    ).rows[0].id
    const drafts = [randomUUID(), randomUUID()]
    for (const [index, draft] of drafts.entries())
      await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
        f.tenant,
        randomUUID(),
        bag,
        draft,
        `Synthetic acceptance coat ${index}`,
        'Coats',
        'Good',
      ])
    await f.commit()
    await page.goto(
      `/intake/bags/${bag}/inspect?view=drafts&draft=${drafts[0]}`,
    )
    const firstPrice = page.locator(`#accept-price-${drafts[0]}`)
    await firstPrice.fill('375')
    await page
      .locator('form')
      .filter({ has: firstPrice })
      .getByRole('checkbox')
      .check()
    await page
      .getByLabel(d.inspection.description, { exact: true })
      .fill('Synthetic acceptance coat 0, lined')
    await page
      .getByRole('button', { name: d.inspection.save, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.inspection.saved)
    await expect(firstPrice).toHaveValue('375')
    await expect(
      page.locator('form').filter({ has: firstPrice }).getByRole('checkbox'),
    ).toBeChecked()
    const next = page
      .locator('.inspection-item')
      .filter({ hasText: 'Synthetic acceptance coat 1' })
      .getByRole('link')
      .first()
    let accepted = false
    let warnings = 0
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toBe(d.leaveUnsaved)
      warnings++
      if (accepted) await dialog.accept()
      else await dialog.dismiss()
    })
    await next.click()
    await expect.poll(() => warnings).toBe(1)
    await expect(firstPrice).toHaveValue('375')
    accepted = true
    await next.click()
    await expect(page.locator(`#accept-price-${drafts[1]}`)).toHaveValue('')
    const secondForm = page
      .locator('form')
      .filter({ has: page.locator(`#accept-price-${drafts[1]}`) })
    await expect(secondForm.getByRole('checkbox')).not.toBeChecked()
    await page.locator('.sidebar a[href="/intake/items"]').click()
    await expect(page).toHaveURL('/intake/items')
    expect(warnings).toBe(2)
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
