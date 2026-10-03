import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelLeave(page: Page, link: Locator) {
  const prompt = page.waitForEvent('dialog')
  const click = link.click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}
async function fixture(page: Page) {
  const email = `sale-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const sold = await f.item('Synthetic historical receipt item')
    const item = await f.item('Synthetic pending cart item')
    const sale = randomUUID()
    await f.db.query("select record_sale($1,$2,'manual',$3,now(),'SEK',$4)", [
      f.tenant,
      sale,
      randomUUID(),
      JSON.stringify([{ itemId: sold, priceOre: 20000 }]),
    ])
    await f.commit()
    await page.goto('/intake/sales')
    await page.locator('.sale-manual > summary').click()
    const search = page.getByLabel(d.sales.search, { exact: true })
    await search.fill('Synthetic pending cart item')
    await search.press('Enter')
    await page.getByRole('button', { name: d.sales.add, exact: true }).click()
    await page.locator(`#price-${item}`).fill('150,50')
    return { f, item, sale }
  } catch (error) {
    await f.close()
    throw error
  }
}

test('manual cart keeps edited prices when leaving is cancelled and releases navigation when emptied', async ({
  page,
}) => {
  const { f, item, sale } = await fixture(page)
  try {
    const receipt = page.locator(
      `.sales-register-row[href="/intake/sales/${sale}"]`,
    )
    await page.locator('.sale-manual > summary').click()
    await cancelLeave(page, receipt)
    await cancelLeave(page, page.locator('.sidebar a[href="/intake/items"]'))
    await page.locator('.sale-manual > summary').click()
    await expect(page.locator(`#price-${item}`)).toHaveValue('150,50')
    await page
      .getByRole('button', { name: d.sales.remove, exact: true })
      .click()
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await receipt.click()
    await expect(page).toHaveURL(`/intake/sales/${sale}`)
    expect(warnings).toBe(0)
  } finally {
    await f.close()
  }
})

test('unconfirmed sale retains cart protection until its exact retry is confirmed', async ({
  page,
}) => {
  const { f, item } = await fixture(page)
  try {
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      if (route.request().postDataJSON()?.action !== 'recordSale')
        return route.continue()
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(page.locator(`#price-${item}`)).toBeDisabled()
    await cancelLeave(page, page.locator('.sidebar a[href="/intake/items"]'))
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page.locator('.sale-cart li')).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await page
      .locator('.sale-workspace')
      .getByRole('link', { name: d.sales.open, exact: true })
      .click()
    await expect(page).toHaveURL(`/intake/sales/${commands[0].requestId}`)
    expect(warnings).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sale_lines where tenant_id=$1 and item_id=$2',
          [f.tenant, item],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('a stale manual sale offers a full reload instead of leaving the frozen cart in place', async ({
  page,
}) => {
  const { f, item } = await fixture(page)
  try {
    await page.route('**/api/intake', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'POLICY_CHANGED' }),
      }),
    )
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(page.locator('.sale-workspace').getByRole('alert')).toHaveText(
      d.intake.changed,
    )
    await expect(page.locator(`#price-${item}`)).toBeDisabled()
    await expect(
      page.getByLabel(d.sales.search, { exact: true }),
    ).toBeDisabled()
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(page.locator('.sale-manual')).not.toHaveAttribute('open', '')
    await page.locator('.sale-manual > summary').click()
    await expect(page.locator('.sale-cart li')).toHaveCount(0)
    await expect(page.getByLabel(d.sales.search, { exact: true })).toBeEnabled()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sale_lines where tenant_id=$1 and item_id=$2',
          [f.tenant, item],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
