import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
const m = d.printing.weblink.managed

for (const lost of [false, true])
  test(`managed setup ${lost ? 'resumes an unknown response' : 'downloads a private file'} without activation`, async ({
    page,
  }, testInfo) => {
    const email = `managed-ui-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const printerId = randomUUID(),
      deviceId = randomUUID()
    try {
      await f.db.query(
        "select register_weblink_printer($1,$2,'Managed Zebra','ZD420',203)",
        [f.tenant, printerId],
      )
      await f.commit()
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto('/settings?tab=printing')
      await page
        .getByRole('radio', { name: d.printing.setup.weblink, exact: false })
        .check()
      const fold = page.locator('.printing-printers > details').filter({
        has: page.locator('summary').filter({ hasText: 'Managed Zebra' }),
      })
      await fold.locator('summary').first().click()
      const setup = fold.getByRole('region', { name: m.title })
      await expect(setup).toBeVisible()
      await expect(
        fold.getByRole('button', { name: d.printing.newCode, exact: true }),
      ).toHaveCount(0)
      let attempts = 0
      await page.route('**/api/print/weblink/managed', async (route) => {
        const input = route.request().postDataJSON()
        expect(input.tenantId).toBe(f.tenant)
        expect(input.printerId).toBe(printerId)
        if (input.action === 'connect') {
          attempts++
          if (lost && attempts === 1)
            return route.fulfill({
              status: 409,
              json: { error: 'PRINT_MANAGED_REVIEW_REQUIRED' },
            })
          return route.fulfill({ json: { ok: true, deviceId } })
        }
        expect(input.action).toBe('configuration')
        return route.fulfill({
          json: {
            ok: true,
            deviceId,
            configuration: 'SYNTHETIC INSTALLATION FILE',
          },
        })
      })
      await setup.getByRole('button', { name: m.prepare, exact: true }).click()
      if (lost) {
        await expect(setup.getByRole('alert')).toHaveText(m.unknown)
        await setup.getByRole('button', { name: m.check, exact: true }).click()
      }
      await expect(
        setup.getByRole('button', { name: m.download, exact: true }),
      ).toBeVisible()
      const downloaded = page.waitForEvent('download')
      await setup.getByRole('button', { name: m.download, exact: true }).click()
      const file = await downloaded
      expect(file.suggestedFilename()).toBe('komisio-zebra-setup.zpl')
      const stream = await file.createReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream!) chunks.push(chunk)
      expect(Buffer.concat(chunks).toString()).toBe(
        'SYNTHETIC INSTALLATION FILE',
      )
      await expect(setup.getByRole('status')).toHaveText(m.downloaded)
      await expect(setup).toContainText(m.private)
      expect(
        (
          await f.db.query('select active from printers where id=$1', [
            printerId,
          ])
        ).rows[0].active,
      ).toBe(false)
      expect(
        (
          await f.db.query(
            'select count(*)::int n from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(375)
      await page.screenshot({
        path: testInfo.outputPath('managed-setup-mobile.png'),
        fullPage: true,
      })
    } finally {
      await f.close()
    }
  })
