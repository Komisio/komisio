import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('stocktake records scans, preserves damage and finishes without sales', async ({
  page,
}, info) => {
  const email = `stocktake-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const first = await f.item('Synthetic blue jacket'),
      second = await f.item('Synthetic green coat')
    await f.commit()
    await page.goto('/intake/stocktake')
    await page
      .getByRole('button', { name: d.stocktake.start, exact: true })
      .click()
    await expect(page.getByLabel(d.stocktake.reference)).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.stocktake.exportAll }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.stocktake.finish, exact: true }),
    ).toBeDisabled()
    const ids: string[] = []
    let dropped = false
    await page.route('**/api/intake', async (route) => {
      const body = route.request().postDataJSON()
      if (body.action !== 'scanStocktake') return route.continue()
      ids.push(body.requestId)
      const response = await route.fetch()
      if (!dropped) {
        dropped = true
        return route.abort()
      }
      return route.fulfill({ response })
    })
    await page.getByLabel(d.stocktake.reference).fill(`I-${first.slice(0, 8)}`)
    await page
      .getByRole('button', { name: d.stocktake.scan, exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page
      .getByRole('button', { name: d.stocktake.scan, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.stocktake.scanned)
    expect(ids[0]).toBe(ids[1])
    const coat = page
      .locator('.stocktake-list li')
      .filter({ hasText: 'Synthetic green coat' })
    await coat.locator('summary').click()
    await coat
      .getByLabel(d.stocktake.finding, { exact: true })
      .selectOption('damaged')
    await coat.getByLabel(d.stocktake.reason).fill('Synthetic broken zip')
    await coat
      .getByRole('button', { name: d.stocktake.save, exact: true })
      .click()
    await expect(
      coat.getByText('Synthetic broken zip', { exact: true }),
    ).toBeVisible()
    await page.getByLabel(d.stocktake.reference).fill(`I-${second.slice(0, 8)}`)
    await page
      .getByRole('button', { name: d.stocktake.scan, exact: true })
      .click()
    await expect(
      coat.getByText(d.stocktake.damaged, { exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.stocktake.scan, exact: true }),
    ).toBeEnabled()
    await expect(page.getByLabel(d.stocktake.reference)).toBeFocused()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: info.outputPath('stocktake-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
    await page
      .getByRole('button', { name: d.stocktake.finish, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: d.stocktake.closed, exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByLabel(d.stocktake.reference)).toHaveCount(0)
    const downloadEvent = page.waitForEvent('download')
    await page
      .getByRole('button', { name: d.stocktake.exportAll, exact: true })
      .click()
    const download = await downloadEvent
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv).toContain(first)
    expect(csv).toContain(second)
    expect(csv).toContain('Synthetic broken zip')
    expect(csv).toContain(d.stocktake.damaged)
    await page
      .getByRole('link', { name: d.stocktake.deviations, exact: true })
      .click()
    const discrepanciesEvent = page.waitForEvent('download')
    await page
      .getByRole('button', { name: d.stocktake.exportDeviations, exact: true })
      .click()
    const discrepancies = await readFile(
      (await (await discrepanciesEvent).path())!,
      'utf8',
    )
    expect(discrepancies).toContain(second)
    expect(discrepancies).not.toContain(first)
    const session = new URL(page.url()).searchParams.get('session')!
    const response = await page.request.get(
      `/api/stocktake/${session}/export?tenant=${f.tenant}&filter=all`,
    )
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect(
      (
        await page.request.get(
          `/api/stocktake/${session}/export?tenant=${randomUUID()}&filter=all`,
        )
      ).status(),
    ).toBe(409)
    expect(
      (
        await page.request.get(
          `/api/stocktake/${randomUUID()}/export?tenant=${f.tenant}&filter=all`,
        )
      ).status(),
    ).toBe(404)
    await page.route('**/api/stocktake/*/export?*', (route) =>
      route.fulfill({ status: 413 }),
    )
    await page
      .getByRole('button', { name: d.stocktake.exportDeviations, exact: true })
      .click()
    await expect(page.locator('p[role="alert"]')).toHaveText(
      d.stocktake.exportTooLarge,
    )
    await page.screenshot({
      path: info.outputPath('stocktake-export-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sale_lines where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
