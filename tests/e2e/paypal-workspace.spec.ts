import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('PayPal tabs separate sales, products and settings, preserve drafts and show pending work', async ({
  page,
}, testInfo) => {
  const email = `paypal-workspace-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const p = d.integrationPage.paypalWorkspace
  try {
    const merchant = randomUUID()
    await f.item('Synthetic POS item')
    await f.db.query(
      "select store_paypal_oauth($1,$2,$3,now()+interval '1 hour',0)",
      [
        f.tenant,
        merchant,
        JSON.stringify({
          iv: 'synthetic',
          tag: 'synthetic',
          data: 'synthetic',
        }),
      ],
    )
    await f.db.query('select enable_zettle_pull($1,$2)', [f.tenant, merchant])
    await f.db.query('select record_zettle_page($1,$2,null,$3,$4::jsonb)', [
      f.tenant,
      randomUUID(),
      'synthetic-page',
      JSON.stringify([
        {
          externalId: randomUUID(),
          occurredAt: new Date().toISOString(),
          currency: 'SEK',
          amountOre: 13000,
          blockedReason: null,
          lines: [
            {
              lineNo: 1,
              reference: null,
              labelConflict: false,
              description: 'Synthetic receipt',
              priceOre: 13000,
            },
          ],
        },
      ]),
    ])
    await f.commit()
    let writes = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/integrations/'))
        writes++
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/intake/integrations?provider=paypal')
    const provider = page.getByTestId('integration-paypal')
    const panel = provider.getByRole('tabpanel')
    await expect(provider.getByRole('tab')).toHaveCount(3)
    await expect(provider.locator(':scope > summary')).toContainText(
      p.connected,
    )
    await expect(
      provider.getByRole('tab', { name: p.sales, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      panel.getByRole('button', { name: p.pull, exact: true }),
    ).toBeVisible()
    await expect(panel.locator('tbody tr')).toHaveCount(1)
    await expect(
      panel.getByText(d.zettle.pullHint, { exact: true }),
    ).not.toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('paypal-sales-desktop.png'),
      fullPage: true,
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/integrations/zettle', async (route) => {
      const body = route.request().postDataJSON()
      expect(body).toMatchObject({ action: 'pull', tenantId: f.tenant })
      await released
      await route.fulfill({ status: 200, json: { id: body.requestId } })
    })
    await panel.getByRole('button', { name: p.pull, exact: true }).click()
    await expect(panel.locator('form[aria-busy="true"]')).toBeVisible()
    await expect(
      panel.getByRole('button', { name: d.zettle.busy, exact: true }),
    ).toBeDisabled()
    await provider.getByRole('tab', { name: p.products, exact: true }).click()
    await expect(
      panel.getByRole('button', { name: p.syncItem, exact: true }),
    ).toBeVisible()
    await provider.getByRole('tab', { name: p.sales, exact: true }).click()
    await expect(panel.locator('form[aria-busy="true"]')).toBeVisible()
    release()
    await expect(panel.getByRole('status')).toContainText(d.zettle.done)
    await provider.getByRole('tab', { name: p.settings, exact: true }).click()
    const images = panel.getByRole('checkbox', {
      name: d.itemSync.preferences.images,
      exact: true,
    })
    await images.check()
    await provider.getByRole('tab', { name: p.products, exact: true }).click()
    const prompt = page.waitForEvent('dialog')
    const leave = panel
      .getByRole('link', { name: d.itemSync.allItems, exact: true })
      .click()
    const dialog = await prompt
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toBe(d.leaveUnsaved)
    await dialog.dismiss()
    await leave
    await expect(page).toHaveURL(
      /\/intake\/integrations\?provider=paypal#paypal-products$/,
    )
    await provider.getByRole('tab', { name: p.settings, exact: true }).click()
    await expect(images).toBeChecked()
    await images.uncheck()
    await page.screenshot({
      path: testInfo.outputPath('paypal-settings-desktop.png'),
      fullPage: true,
    })
    await provider.getByRole('tab', { name: p.settings, exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(
      provider.getByRole('tab', { name: p.products, exact: true }),
    ).toBeFocused()
    await expect(
      provider.getByRole('tab', { name: p.products, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('paypal-products-mobile.png'),
      fullPage: true,
    })
    await page.reload()
    await expect(
      provider.getByRole('tab', { name: p.products, exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(writes).toBe(1)
  } finally {
    await f.close()
  }
})
