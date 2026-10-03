import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('account mapping warns before leaving but allows in-page guidance and reverted fields', async ({
  page,
}) => {
  const email = `map-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const region = page.locator('#account-map')
    const gross = region.locator('input[name="account:grossOre"]')
    const side = region.locator('select[name="side:grossOre"]')
    await gross.fill('1930')
    await side.selectOption('credit')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      expect(dialog.message()).toBe(d.leaveUnsaved)
      await dialog.dismiss()
    })
    await page
      .locator('.accounting-settings-links a[href="#accounting-systems"]')
      .click()
    expect(warnings).toBe(0)
    const next = page.locator('a[href="/intake/accounting"]').first()
    await next.click()
    await expect.poll(() => warnings).toBe(1)
    await expect(gross).toHaveValue('1930')
    await expect(side).toHaveValue('credit')
    await gross.fill('')
    await side.selectOption('debit')
    await next.click()
    await expect(page).toHaveURL('/intake/accounting')
    expect(warnings).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_maps where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('account mapping keeps one uncertain publication and clears the warning after confirmation', async ({
  page,
}) => {
  const email = `map-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const region = page.locator('#account-map')
    const gross = region.locator('input[name="account:grossOre"]')
    await gross.fill('1930')
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'publishAccountingMap') return route.continue()
      requests.push(command)
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (requests.length === 1)
        return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      return route.fulfill({ response })
    })
    await region
      .getByRole('button', { name: d.accounting.publishMap, exact: true })
      .click()
    await expect(region.getByRole('alert')).toHaveText(d.intake.failed)
    await expect(gross).toBeDisabled()
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    const next = page.locator('.sidebar a[href="/intake/items"]')
    await next.click()
    await expect.poll(() => warnings).toBe(1)
    await region
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(region).toContainText(`${d.accounting.mapVersion} 1`)
    await expect(gross).toHaveValue('1930')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    await next.click()
    await expect(page).toHaveURL('/intake/items')
    expect(warnings).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_maps where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
