import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store settings contain chain choices and plan at phone and iPad widths', async ({
  page,
}, testInfo) => {
  const email = `store-tablet-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const names = [
      'Second store ' + 'L'.repeat(80),
      'Third store ' + 'M'.repeat(80),
      'Fourth store ' + 'N'.repeat(80),
    ]
    const stores: string[] = []
    for (const name of names)
      stores.push(
        (
          await f.db.query('select create_tenant($1,$2,$3) id', [
            name,
            `store-${randomUUID()}`,
            randomUUID(),
          ])
        ).rows[0].id,
      )
    await f.db.query('select set_active_tenant($1)', [f.tenant])
    await f.commit()
    await f.db.query('select komisio_private.enable_billing($1)', [f.actor])
    await page.goto('/settings?tab=store')
    const fits = async () => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      // Inspect every actual rectangle, including unbroken store names and the select.
      expect(
        await page
          .locator('.chain-panel label, .chain-panel select, .chain-panel li')
          .evaluateAll((nodes) =>
            nodes.every((n) => {
              const r = n.getBoundingClientRect()
              return r.left >= 0 && r.right <= innerWidth
            }),
          ),
      ).toBe(true)
    }
    for (const width of [375, 768, 820, 834, 1024, 1180]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(
        page.getByRole('heading', { name: d.audit, exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('heading', { name: d.plans.heading, exact: true }),
      ).toBeVisible()
      await fits()
      for (const box of await page.locator('.chain-store-choice input').all()) {
        const r = await box.boundingBox()
        expect(r?.width).toBe(20)
        expect(r?.height).toBe(20)
      }
      if (width === 768)
        await page.screenshot({
          path: testInfo.outputPath('store-settings-portrait.png'),
          fullPage: true,
        })
    }
    await page
      .getByLabel(d.chain.name, { exact: true })
      .fill('Synthetic chain ' + 'C'.repeat(80))
    await page.getByLabel(names[0], { exact: true }).check()
    await page.getByLabel(names[1], { exact: true }).check()
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/platform') &&
        r.request().postDataJSON()?.action === 'chainCreate',
    )
    await page
      .getByRole('button', { name: d.chain.create, exact: true })
      .click()
    const response = await created
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON().tenantIds.sort()).toEqual(
      [f.tenant, stores[0], stores[1]].sort(),
    )
    await expect(
      page.getByLabel(d.chain.addStore, { exact: true }),
    ).toBeVisible()
    for (const width of [375, 768, 820, 834, 1024, 1180]) {
      await page.setViewportSize({ width, height: 900 })
      await fits()
    }
    await page.reload()
    await expect(
      page.getByLabel(d.chain.addStore, { exact: true }),
    ).toHaveValue(stores[2])
    await page.screenshot({
      path: testInfo.outputPath('store-settings-landscape.png'),
      fullPage: true,
    })
  } finally {
    await f.db.query('update platform_settings set billing_enabled=false')
    await f.close()
  }
})
