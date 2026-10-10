import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import { inventoryColumns } from '../../lib/engine/inventory-import'

test('owner checks a stock file without creating stock and can correct and retry it', async ({
  page,
  browser,
}, testInfo) => {
  const email = `inventory-preview-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('commit')
    await page.goto('/intake/import')
    await page.getByRole('link', { name: d.inventoryImport.title }).click()
    await expect(
      page.getByRole('button', { name: d.inventoryImport.choose, exact: true }),
    ).toBeEnabled()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: d.inventoryImport.template }).click()
    const template = await readFile((await (await download).path())!, 'utf8')
    expect(template).toContain(inventoryColumns.join(';'))
    const makeFile = (body: string) => ({
      name: 'synthetic-stock.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(inventoryColumns.join(';') + '\n' + body),
    })
    await page
      .locator('#inventory-file')
      .setInputFiles(
        makeFile(
          `001;${f.seller};;Blue shirt;150,25;SEK\n002;;missing@example.test;Red coat;100;EUR\n002;${f.seller};;White shirt;1,000;SEK`,
        ),
      )
    await page
      .getByRole('button', { name: d.inventoryImport.check, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      d.inventoryImport.problems.replace('{count}', '2'),
    )
    await expect(
      page.getByText(d.inventoryImport.issues.duplicate, { exact: true }),
    ).toHaveCount(2)
    await expect(
      page.getByText(d.inventoryImport.issues.currency, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.inventoryImport.issues.price, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.inventoryImport.issues.missing, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.inventoryImport.noWrites, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: d.inventoryImport.result,
        exact: true,
      }),
    ).toBeFocused()
    const reportDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: d.inventoryImport.download }).click()
    const result = JSON.parse(
      await readFile((await (await reportDownload).path())!, 'utf8'),
    )
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({
      priceOre: 15025,
      seller: { id: f.seller, status: 'matched' },
      issues: [],
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
    await page.screenshot({
      path: testInfo.outputPath('inventory-import-mobile.png'),
      fullPage: true,
    })
    await page
      .locator('#inventory-file')
      .setInputFiles(makeFile(`003;${f.seller};;Blue shirt;150,25;SEK`))
    await expect(
      page.getByRole('heading', {
        name: d.inventoryImport.result,
        exact: true,
      }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: d.inventoryImport.check, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      d.inventoryImport.noProblems,
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    const response = await page.request.post('/api/import/items/preview', {
      headers: { origin: 'http://127.0.0.1:3000' },
      data: {
        tenantId: randomUUID(),
        file: {
          source: 'x',
          rows: [
            {
              line: 2,
              reference: '1',
              sellerId: f.seller,
              email: '',
              description: 'Shirt',
              price: '100',
              currency: 'SEK',
            },
          ],
        },
      },
    })
    expect(response.status()).toBe(409)
    const crossOrigin = await page.request.post('/api/import/items/preview', {
      headers: { origin: 'https://invalid.example.test' },
      data: {},
    })
    expect(crossOrigin.status()).toBe(403)
    await page
      .getByRole('button', { name: d.inventoryImport.clear, exact: true })
      .click()
    await page.locator('#inventory-file').setInputFiles(makeFile('bad;file'))
    await expect(
      page.locator('.inventory-import-workspace [role="alert"]'),
    ).toHaveText(d.inventoryImport.invalidFile)
    const staffContext = await browser.newContext()
    try {
      const staffPage = await staffContext.newPage(),
        staffEmail = `import-staff-${randomUUID()}@example.test`
      await register(staffPage, staffEmail, `K!${randomUUID()}`)
      await f.db.query(
        "insert into tenant_members(tenant_id,user_id,role) select $1,id,'staff' from auth.users where email=$2",
        [f.tenant, staffEmail],
      )
      await staffPage.goto('/intake/import/items')
      await expect(
        staffPage.getByRole('heading', { name: d.notFound, exact: true }),
      ).toBeVisible()
      const denied = await staffPage.request.post('/api/import/items/preview', {
        headers: { origin: 'http://127.0.0.1:3000' },
        data: {},
      })
      expect(denied.status()).toBe(403)
    } finally {
      await staffContext.close()
    }
  } finally {
    await f.db.end()
  }
})
