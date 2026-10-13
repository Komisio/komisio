import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('receiving labels separate browser printing from the correct Zebra custody job', async ({
  page,
}) => {
  const email = `receiving-label-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const session = randomUUID()
    const receipt = randomUUID()
    const printer = randomUUID()
    await f.db.query('select create_reception_session($1,$2,$3)', [
      f.tenant,
      session,
      f.seller,
    ])
    await f.db.query("select receive_garment($1,$2,$3,'')", [
      f.tenant,
      receipt,
      session,
    ])
    await f.db.query(
      "select register_printer($1,$2,'Synthetic Zebra','tcp','127.0.0.1:9100','Synthetic',203,true)",
      [f.tenant, printer],
    )
    await f.commit()
    await page.goto(`/intake/reception/${session}/label`)
    await expect(
      page.getByRole('heading', {
        name: d.printing.kinds.garment,
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText(d.reception.custodyHelp)).toHaveCount(0)
    const preview = page.locator('.bag-label-preview')
    const controls = page.locator('.bag-label-print')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(preview).toBeVisible()
      await expect(controls).toBeVisible()
      const a = (await preview.boundingBox())!
      const b = (await controls.boundingBox())!
      if (width === 1440) expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
      else expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await page.evaluate(() => {
      window.print = () => {
        document.body.dataset.printInvoked = 'true'
      }
    })
    await page
      .getByRole('button', { name: d.printing.browserOpen, exact: true })
      .click()
    await expect(page.locator('body')).toHaveAttribute(
      'data-print-invoked',
      'true',
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await page.getByLabel(d.printing.copies, { exact: true }).fill('2')
    await page
      .getByRole('button', { name: d.printing.queue, exact: true })
      .click()
    await expect(controls.getByRole('status')).toHaveText(d.printing.queued)
    expect(
      (
        await f.db.query(
          'select reference_kind,reference_id,label_kind,printer_id,copies from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([
      {
        reference_kind: 'garment_receipt',
        reference_id: receipt,
        label_kind: 'garment',
        printer_id: printer,
        copies: 2,
      },
    ])
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: 'test-results/reception-label-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.screenshot({
      path: 'test-results/reception-label-mobile.png',
      fullPage: true,
    })
    await page.emulateMedia({ media: 'print' })
    await expect(controls).not.toBeVisible()
    await expect(page.locator('.bag-label')).toBeVisible()
  } finally {
    await f.close()
  }
})
