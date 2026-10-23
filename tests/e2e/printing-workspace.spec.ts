import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('USB registration validates the Windows queue and keeps its name across tabs', async ({
  page,
}, testInfo) => {
  const email = `usb-printer-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=printing')
    await page
      .getByRole('radio', { name: d.printing.setup.windows, exact: false })
      .check()
    const form = page.locator('.printer-register-fold form')
    await form
      .getByLabel(d.printing.name, { exact: true })
      .fill('Synthetic USB printer')
    await form
      .getByLabel(d.printing.transport, { exact: true })
      .selectOption('usb')
    const address = form.getByLabel(d.printing.usbQueueName, { exact: true })
    await expect(
      form.getByText(d.printing.usbHint, { exact: true }),
    ).toBeVisible()
    let writes = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/intake'))
        writes++
    })
    await form
      .getByRole('button', { name: d.printing.register, exact: true })
      .click()
    await expect(address).toBeFocused()
    await expect(form.getByRole('alert')).toHaveText(d.printing.usbQueueInvalid)
    await address.fill('\\\\server\\printer')
    await form
      .getByRole('button', { name: d.printing.register, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(d.printing.usbQueueInvalid)
    expect(writes).toBe(0)
    const queue = "ZDesigner USB (åäö) & 'label'"
    await address.fill(queue)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({
      path: testInfo.outputPath('usb-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 375, height: 800 })
    await page.screenshot({
      path: testInfo.outputPath('usb-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375)
    await page
      .getByRole('tab', { name: d.printing.tabs.install, exact: true })
      .click()
    await expect(
      page.getByText(d.printing.installIntro, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('tab', { name: d.printing.tabs.printers, exact: true })
      .click()
    await expect(address).toHaveValue(queue)
    await form
      .getByRole('button', { name: d.printing.register, exact: true })
      .click()
    const printer = page.locator('.printing-printers > details').filter({
      has: page.locator('summary', { hasText: 'Synthetic USB printer' }),
    })
    await expect(printer.locator('summary')).toBeVisible()
    await printer.locator('summary').click()
    await expect(
      printer.getByLabel(d.printing.usbQueueName, { exact: true }),
    ).toHaveValue(queue)
    await printer
      .getByRole('button', { name: d.printing.newCode, exact: true })
      .click()
    await expect(
      printer.locator('.print-devices [role="status"] strong'),
    ).toHaveText(/^[0-9A-F]{5}-[0-9A-F]{5}$/)
    expect(
      (
        await f.db.query(
          'select transport,address from printers where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ transport: 'usb', address: queue }])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('printer setup offers installation before registration and preserves drafts between task tabs', async ({
  page,
}, testInfo) => {
  const email = `printing-workspace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/settings?tab=printing')
    await page
      .getByRole('radio', { name: d.printing.setup.windows, exact: false })
      .check()
    const download = page.getByRole('link', {
      name: d.printing.download,
      exact: true,
    })
    await expect(download).toBeVisible()
    await expect(download).toHaveAttribute(
      'href',
      /KomisioPrint-staging-win-x64\.zip$/,
    )
    const tabs = page.getByRole('tablist', {
      name: d.printing.title,
      exact: true,
    })
    await expect(tabs.getByRole('tab')).toHaveCount(4)
    await expect(
      page.getByRole('tabpanel', {
        name: d.printing.tabs.printers,
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(d.printing.noJobs, { exact: true }),
    ).toBeHidden()
    const form = page.locator('.printer-register-fold form')
    await form
      .getByLabel(d.printing.name, { exact: true })
      .fill('Synthetic network printer')
    // The example address is a placeholder, not a registered printer address.
    const address = form.getByLabel(d.printing.address, { exact: true })
    await expect(address).toHaveValue('')
    await form
      .getByRole('button', { name: d.printing.register, exact: true })
      .click()
    await expect(address).toBeFocused()
    await expect(address).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByRole('alert')).toHaveText(d.printing.addressInvalid)
    await address.fill('192.168.1.50:9100')
    await page.screenshot({
      path: testInfo.outputPath('printers-desktop.png'),
      fullPage: true,
    })
    await tabs
      .getByRole('tab', { name: d.printing.tabs.printers, exact: true })
      .focus()
    await page.keyboard.press('ArrowRight')
    await expect(
      tabs.getByRole('tab', { name: d.printing.tabs.install, exact: true }),
    ).toBeFocused()
    await expect(
      page.getByText(d.printing.installIntro, { exact: true }),
    ).toBeVisible()
    await expect(form).toBeHidden()
    await expect(download).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('installation-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 375, height: 800 })
    await page.screenshot({
      path: testInfo.outputPath('installation-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('tabpanel', { name: d.printing.tabs.install, exact: true })
      .getByRole('link', { name: d.printing.tabs.printers, exact: true })
      .first()
      .click()
    await expect(form.getByLabel(d.printing.name, { exact: true })).toHaveValue(
      'Synthetic network printer',
    )
    await expect(address).toHaveValue('192.168.1.50:9100')
    await form
      .getByRole('button', { name: d.printing.register, exact: true })
      .click()
    const printer = page.locator('.printing-printers > details').filter({
      has: page.locator('summary', { hasText: 'Synthetic network printer' }),
    })
    await expect(printer.locator('summary')).toBeVisible()
    await printer.locator('summary').click()
    await printer
      .getByRole('button', { name: d.printing.newCode, exact: true })
      .click()
    await expect(printer.getByRole('status')).toContainText(
      /[0-9A-F]{5}-[0-9A-F]{5}/,
    )
    expect(
      (
        await f.db.query(
          'select name,address,transport from printers where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([
      {
        name: 'Synthetic network printer',
        address: '192.168.1.50:9100',
        transport: 'tcp',
      },
    ])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
