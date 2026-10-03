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

test('seller edits survive tabs and cancelled departure; restoring fields releases the warning', async ({
  page,
}) => {
  const email = `seller-unsaved-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic seller draft item')
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-details`)
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    const name = page.locator('#seller-profile-name')
    const original = await name.inputValue()
    await name.fill('Synthetic unsaved seller name')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.items, exact: true })
      .click()
    await cancelLeave(
      page,
      page.getByRole('tabpanel').getByRole('link', {
        name: 'Synthetic seller draft item',
        exact: true,
      }),
    )
    await expect(page).toHaveURL(
      new RegExp(`/sellers/${f.seller}#seller-items$`),
    )
    await page
      .getByRole('tab', { name: d.sellerWorkspace.details, exact: true })
      .click()
    await expect(name).toHaveValue('Synthetic unsaved seller name')
    await cancelLeave(page, page.locator('.sidebar a[href="/intake/sellers"]'))
    const prompt = page.waitForEvent('dialog')
    await page.evaluate(() => setTimeout(() => location.reload(), 0))
    const dialog = await prompt
    expect(dialog.type()).toBe('beforeunload')
    await dialog.dismiss()
    await expect(name).toHaveValue('Synthetic unsaved seller name')
    await name.fill(original)
    let unexpected = 0
    page.on('dialog', async (dialog) => {
      unexpected++
      await dialog.dismiss()
    })
    await page
      .getByRole('tab', { name: d.sellerWorkspace.items, exact: true })
      .click()
    await page
      .getByRole('tabpanel')
      .getByRole('link', { name: 'Synthetic seller draft item', exact: true })
      .click()
    await expect(page).toHaveURL(`/intake/items/${item}`)
    expect(unexpected).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_profile_versions where tenant_id=$1 and seller_id=$2 and revision>0',
          [f.tenant, f.seller],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('unconfirmed seller save warns until the same request is confirmed without another profile version', async ({
  page,
}) => {
  const email = `seller-unsaved-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-details`)
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    const name = page.locator('#seller-profile-name')
    await name.fill('Synthetic confirmed seller')
    const requests: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action !== 'saveSellerProfile') return route.continue()
      requests.push(payload)
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (requests.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.sellerDetails.save, exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(name).toBeDisabled()
    const leave = page.locator('.sidebar a[href="/intake/sellers"]')
    await cancelLeave(page, leave)
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic confirmed seller',
        exact: true,
      }),
    ).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    let unexpected = 0
    page.on('dialog', async (dialog) => {
      unexpected++
      await dialog.dismiss()
    })
    await leave.click()
    await expect(page).toHaveURL('/intake/sellers')
    expect(unexpected).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_profile_versions where tenant_id=$1 and seller_id=$2 and revision>0',
          [f.tenant, f.seller],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
