import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('Zebra shortcuts queue the selected label from item and browser-label pages', async ({
  page,
}, testInfo) => {
  const email = `zebra-shortcut-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic striped shirt')
    const printer = randomUUID()
    await f.db.query(
      "select register_printer($1,$2,$3,'usb',$4,'Zebra',203,true)",
      [f.tenant, printer, 'Synthetic USB Zebra', 'Synthetic Windows queue'],
    )
    await f.commit()
    let writes = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/print')) writes++
    })
    for (const [index, path] of [
      `/intake/items/${item}`,
      `/intake/items/${item}/label`,
    ].entries()) {
      if (index === 1) {
        await f.asActor(f.actor, () =>
          f.db.query('select set_item_price($1,$2,$3,15000,$4)', [
            f.tenant,
            randomUUID(),
            item,
            'Synthetic markdown',
          ]),
        )
      }
      await page.goto(path)
      if (index === 0)
        await page.locator('.item-print-options > summary').click()
      const trigger = page.getByRole('button', {
        name: d.printing.zebraPrint,
        exact: true,
      })
      await expect(trigger).toBeInViewport()
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: d.printing.zebraPrint })
      await expect(dialog).toBeVisible()
      expect(writes).toBe(index)
      await dialog
        .getByLabel(d.printing.printer, { exact: true })
        .selectOption(printer)
      await dialog.getByLabel(d.printing.copies, { exact: true }).fill('2')
      await page.setViewportSize({ width: 375, height: 800 })
      await page.screenshot({
        path: testInfo.outputPath(`zebra-mobile-${index}.png`),
      })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(375)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.screenshot({
        path: testInfo.outputPath(`zebra-desktop-${index}.png`),
      })
      await dialog
        .getByRole('button', { name: d.printing.queue, exact: true })
        .click()
      await expect(dialog.getByRole('status')).toHaveText(d.printing.queued)
      await dialog
        .getByRole('button', { name: d.printing.close, exact: true })
        .click()
      await expect(trigger).toBeFocused()
    }
    expect(writes).toBe(2)
    const jobs = await f.db.query(
      'select printer_id,copies,label_kind as kind,status from print_jobs where tenant_id=$1 order by created_at',
      [f.tenant],
    )
    expect(jobs.rows).toEqual([
      { printer_id: printer, copies: 2, kind: 'item', status: 'queued' },
      { printer_id: printer, copies: 2, kind: 'markdown', status: 'queued' },
    ])
  } finally {
    await f.close()
  }
})
