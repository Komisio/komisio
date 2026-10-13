import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('preview, confirm custody, import and recover a lost response without duplicates', async ({
  page,
}, testInfo) => {
  const email = `inventory-import-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import/items')
    await expect(
      page.getByRole('heading', { name: d.inventoryImport.title, exact: true }),
    ).toBeVisible()
    const file = {
      name: 'synthetic-items.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'reference;sellerId;email;description;price;currency\n' +
          Array.from(
            { length: 30 },
            (_, i) => `IMPORT-${i};${f.seller};;Synthetic item ${i};125,25;SEK`,
          ).join('\n'),
      ),
    }
    await page.locator('#inventory-file').setInputFiles(file)
    await page
      .getByRole('button', { name: d.inventoryImport.check, exact: true })
      .click()
    await expect(
      page.getByText(d.inventoryImport.noProblems, { exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await expect(
      page.getByRole('button', { name: d.inventoryImport.import, exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('checkbox', { name: d.inventoryImport.received })
      .check()
    await page.screenshot({
      path: testInfo.outputPath('item-import-preview.png'),
      fullPage: true,
    })
    let lost = true
    const requests: unknown[] = []
    await page.route('**/api/import/items', async (route) => {
      requests.push(route.request().postDataJSON())
      const response = await route.fetch()
      if (lost && response.ok()) {
        lost = false
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.inventoryImport.import, exact: true })
      .click()
    await expect(
      page.locator('.inventory-import-workspace [role="alert"]'),
    ).toHaveText(d.inventoryImport.retry, {
      timeout: 30000,
    })
    await expect(
      page.getByRole('button', { name: d.inventoryImport.clear, exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: d.inventoryImport.import, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: d.inventoryImport.complete }),
    ).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    await expect(page.getByRole('status')).toHaveText(
      d.inventoryImport.completed
        .replace('{created}', '30')
        .replace('{skipped}', '0'),
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(30)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
    await page.screenshot({
      path: testInfo.outputPath('item-import-result-mobile.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: d.inventoryImport.another }).click()
    await page
      .locator('#inventory-file')
      .setInputFiles({ ...file, name: 'renamed.csv' })
    await page
      .getByRole('button', { name: d.inventoryImport.check, exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: d.inventoryImport.received })
      .check()
    await page
      .getByRole('button', { name: d.inventoryImport.import, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      d.inventoryImport.completed
        .replace('{created}', '0')
        .replace('{skipped}', '30'),
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(30)
    const createdLink = page
      .locator('.inventory-import-workspace a[href^="/intake/items/"]')
      .first()
    await createdLink.click()
    await expect(
      page.getByRole('heading', { name: 'Synthetic item 0', exact: true }),
    ).toBeVisible()
    const denied = await page.request.post('/api/import/items', {
      headers: { origin: 'https://wrong.example.test' },
      data: requests[0],
    })
    expect(denied.status()).toBe(403)
    const foreign = await page.request.post('/api/import/items', {
      headers: { origin: 'http://127.0.0.1:3000' },
      data: { ...(requests[0] as object), tenantId: randomUUID() },
    })
    expect(foreign.status()).toBe(409)
  } finally {
    await f.db.end()
  }
})
