import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const reply of ['lost', 'wrong-id'] as const)
  test(`seller import keeps the reviewed file frozen after a ${reply} response`, async ({
    page,
  }, testInfo) => {
    const email = `import-review-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/intake/import')
      const file = page.locator('#import-file')
      await expect(file).toBeEnabled()
      await file.setInputFiles({
        name: 'synthetic.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'name,email,phone\nSynthetic Imported Seller,synthetic-import@example.test,0700000000',
        ),
      })
      const preview = page.getByRole('region', {
        name: d.importer.preview,
        exact: true,
      })
      await expect(preview).toContainText('Synthetic Imported Seller')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/import', async (route) => {
        requests.push(route.request().postDataJSON())
        if (requests.length !== 1) return route.continue()
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.fulfill({
          status: reply === 'lost' ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            reply === 'lost'
              ? { error: 'REQUEST_FAILED' }
              : { ok: true, operationId: randomUUID() },
          ),
        })
      })
      await page
        .getByRole('button', { name: d.importer.stage, exact: true })
        .click()
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.intake.failed)
      await expect(file).toBeDisabled()
      await expect(page.locator('#import-name')).toBeDisabled()
      await expect(
        page.getByLabel(d.importer.skipHeader, { exact: true }),
      ).toBeDisabled()
      await page
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect(preview.getByRole('status')).toContainText(d.importer.staged)
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      await expect(
        preview.getByRole('link', { name: d.importer.openQueue }),
      ).toHaveAttribute('href', `/intake/operations/${requests[0].requestId}`)
      await expect(file).toBeEnabled()
      await expect(page.locator('#import-name')).toBeDisabled()
      expect(
        (
          await f.db.query(
            "select id from pending_operations where tenant_id=$1 and kind='importSellers'",
            [f.tenant],
          )
        ).rows,
      ).toHaveLength(1)
      expect(
        (
          await f.db.query(
            'select count(*)::int count from sellers where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].count,
      ).toBe(1)
      await page.screenshot({
        path: testInfo.outputPath('import-mobile.png'),
        fullPage: true,
        caret: 'initial',
      })
      await file.setInputFiles([])
      await expect(preview).not.toBeVisible()
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveCount(0)
      await file.setInputFiles({
        name: 'empty.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(''),
      })
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.importer.nothing)
      await file.setInputFiles({
        name: 'large.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('x'.repeat(2_000_001)),
      })
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.importer.fileTooLarge)
      const many = [
        'name,email,phone',
        ...Array.from(
          { length: 201 },
          (_, i) => `Synthetic ${i},seller-${i}@example.test,`,
        ),
      ].join('\n')
      await file.setInputFiles({
        name: 'too-many.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(many),
      })
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.importer.tooMany)
      await expect(
        page.getByRole('button', { name: d.importer.stage, exact: true }),
      ).toBeDisabled()
    } finally {
      await f.close()
    }
  })

test('import file selection waits for its client handler', async ({ page }) => {
  const email = `import-ready-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release!: () => void
  const scripts = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.commit()
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.goto('/intake/import', { waitUntil: 'commit' })
    const file = page.locator('#import-file')
    await expect(file).toBeVisible()
    await expect(file).toBeDisabled()
    release()
    await expect(file).toBeEnabled()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('an oversized import is rejected before decoding and the next file can still be reviewed', async ({
  page,
}) => {
  const email = `import-size-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import')
    const input = page.locator('#import-file')
    await expect(input).toBeEnabled()
    await page.evaluate(() => {
      const original = File.prototype.text
      File.prototype.text = function () {
        if (this.name === 'oversized.csv')
          throw new Error('Oversized contents must not be decoded')
        return original.call(this)
      }
    })
    await input.setInputFiles({
      name: 'oversized.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(8_000_001, 120),
    })
    await expect(
      page.locator('.import-workspace').getByRole('alert'),
    ).toHaveText(d.importer.fileTooLarge)
    await expect(
      page.getByRole('button', { name: d.importer.stage, exact: true }),
    ).toHaveCount(0)
    await input.setInputFiles({
      name: 'small.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'name,email,phone\nSynthetic small import,small@example.test,',
      ),
    })
    await expect(
      page.getByRole('region', { name: d.importer.preview, exact: true }),
    ).toContainText('Synthetic small import')
    await expect(
      page.locator('.import-workspace').getByRole('alert'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.importer.stage, exact: true }),
    ).toBeEnabled()
  } finally {
    await f.close()
  }
})
