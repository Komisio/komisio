import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('purchase drafts survive history paging and cancelled item navigation; restoring fields clears the warning', async ({
  page,
}) => {
  const email = `purchase-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 21; i++)
      await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
        f.tenant,
        randomUUID(),
        `Synthetic purchase ${i}`,
        10000,
        `Synthetic evidence ${i}`,
      ])
    const purchase = (
      await f.db.query(
        'select id from purchase_receipts where tenant_id=$1 order by purchased_at desc,id limit 1',
        [f.tenant],
      )
    ).rows[0].id
    const item = randomUUID()
    await f.db.query("select accept_item($1,$2,'purchase',$3,null,20000)", [
      f.tenant,
      item,
      purchase,
    ])
    await f.commit()
    await page.goto('/intake/purchases')
    await page.locator('.purchase-create > summary').click()
    const price = page.locator('#purchase-price'),
      evidence = page.locator('#purchase-evidence')
    await price.fill('125')
    await evidence.fill('Synthetic draft receipt identifier')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      expect(dialog.message()).toBe(d.leaveUnsaved)
      await dialog.dismiss()
    })
    await page
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .first()
      .click()
    await expect(page.locator('.purchase-entry')).toHaveCount(1)
    await expect(evidence).toHaveValue('Synthetic draft receipt identifier')
    expect(warnings).toBe(0)
    await page
      .getByRole('link', { name: d.sellersList.previousPage, exact: true })
      .first()
      .click()
    await expect(page.locator('.purchase-entry')).toHaveCount(20)
    await page.locator(`a[href="/intake/items/${item}"]`).click()
    await expect.poll(() => warnings).toBe(1)
    await expect(price).toHaveValue('125')
    await expect(evidence).toHaveValue('Synthetic draft receipt identifier')
    await price.fill('')
    await evidence.fill('')
    await page.locator(`a[href="/intake/items/${item}"]`).click()
    await expect(page).toHaveURL(`/intake/items/${item}`)
    expect(warnings).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from purchase_receipts where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(21)
  } finally {
    await f.close()
  }
})

test('a lost purchase reply keeps its draft protected and a confirmed retry clears the form baseline', async ({
  page,
}) => {
  const email = `purchase-draft-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/purchases')
    await page.locator('.purchase-create > summary').click()
    const price = page.locator('#purchase-price'),
      evidence = page.locator('#purchase-evidence')
    const form = page.locator('form').filter({ has: price })
    await price.fill('125')
    await evidence.fill('Synthetic retained receipt')
    await form
      .getByRole('checkbox', { name: d.purchases.confirm, exact: true })
      .check()
    const commands: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      if (route.request().postDataJSON().action !== 'registerPurchase')
        return route.continue()
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1) return route.abort('failed')
      return route.fulfill({ response })
    })
    await form
      .getByRole('button', { name: d.purchases.register, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(d.intake.failed)
    await expect(price).toBeDisabled()
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    const next = page.locator('.sidebar a[href="/intake/items"]')
    await next.click()
    await expect.poll(() => warnings).toBe(1)
    await form
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.purchases.registered)
    await expect(price).toHaveValue('')
    await expect(evidence).toHaveValue('')
    await expect(price).toBeEnabled()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await evidence.fill('Another unsaved receipt')
    await expect(form.getByRole('status')).toHaveCount(0)
    await next.click()
    await expect.poll(() => warnings).toBe(2)
    await evidence.fill('')
    await next.click()
    await expect(page).toHaveURL('/intake/items')
    expect(warnings).toBe(2)
    const receipts = (
      await f.db.query(
        'select purchase_price_ore,evidence_reference from purchase_receipts where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(receipts).toHaveLength(1)
    expect(Number(receipts[0].purchase_price_ore)).toBe(12500)
    expect(receipts[0].evidence_reference).toBe('Synthetic retained receipt')
  } finally {
    await f.close()
  }
})
