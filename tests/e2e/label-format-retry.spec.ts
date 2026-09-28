import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The label size row on the printing settings tab. Only the local synthetic
// store; no printer job, template, provider or physical print is involved.

async function openRow(page: Page, email: string) {
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  await f.commit()
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/settings?tab=printing')
  const row = page.getByRole('group', {
    name: new RegExp(d.printing.kinds.item),
  })
  const width = row.getByLabel(d.printing.width, { exact: true })
  const height = row.getByLabel(d.printing.height, { exact: true })
  await expect(width).toBeEnabled()
  return { f, row, width, height }
}

/**
 * Real geometry, no auto-scroll: boundingBox() reads the current layout, so
 * every named control must lie inside the 320px viewport as the page stands.
 */
async function expectInsideViewport(
  page: Page,
  controls: Record<string, ReturnType<Page['locator']>>,
) {
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  for (const [label, control] of Object.entries(controls)) {
    const box = (await control.boundingBox())!
    expect(box, label).not.toBeNull()
    expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(320)
  }
}

test('an uncertain label size requires reload and preserves a later edit', async ({ page }) => {
  const { f, row, width, height } = await openRow(page, `label-format-recovery-${randomUUID()}@example.test`)
  try {
    await width.fill('60')
    await height.fill('40')
    const commands: Record<string, unknown>[] = []
    let firstStatus = 0
    await page.route('**/api/intake', async route => {
      const command = route.request().postDataJSON()
      if (command?.action !== 'setLabelFormat') return route.continue()
      commands.push(command)
      const response = await route.fetch()
      firstStatus = response.status()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'REQUEST_FAILED' }) })
    })
    await row.getByRole('button', { name: d.printing.saveFormat, exact: true }).click()
    await expect(row.getByRole('alert')).toBeVisible()
    expect(firstStatus).toBe(200)
    // A later edit is a real separate engine transaction, not a mock response.
    await f.asActor(f.actor, async () => {
      await f.db.query('select set_label_format($1,$2,$3,$4)', [f.tenant, 'item', 72, 45])
    })
    await expect(width).toBeDisabled()
    await expect(height).toBeDisabled()
    const reload = row.getByRole('button', { name: d.intake.reload, exact: true })
    await expect(reload).toBeVisible()
    await expect(row.getByRole('button', { name: d.intake.retry, exact: true })).toHaveCount(0)
    await expect(row.getByRole('button', { name: d.printing.saveFormat, exact: true })).toBeDisabled()
    await expectInsideViewport(page, { width, height, reload, alert: row.getByRole('alert') })
    await reload.click()
    await expect(width).toHaveValue('72')
    await expect(height).toHaveValue('45')
    await expect(width).toBeEnabled()
    expect(commands).toHaveLength(1)
    expect((await f.db.query('select kind,width_mm,height_mm from label_formats where tenant_id=$1', [f.tenant])).rows).toEqual([{ kind: 'item', width_mm: '72.0', height_mm: '45.0' }])
    expect((await f.db.query("select count(*)::int n from access_events where tenant_id=$1 and action='label_format.set'", [f.tenant])).rows[0].n).toBe(2)
    expect((await f.db.query('select count(*)::int n from print_jobs where tenant_id=$1', [f.tenant])).rows[0].n).toBe(0)
  } finally { await f.close() }
})

test('a changed active store offers a reload instead of a permanently disabled row', async ({
  page,
}) => {
  const { f, row, width, height } = await openRow(
    page,
    `label-format-stale-${randomUUID()}@example.test`,
  )
  try {
    await width.fill('70')
    // The same owner switches store in another session before saving; the
    // route then answers 409 TENANT_CHANGED for this page's store (actual,
    // not synthetic).
    await f.asActor(f.actor, async () => {
      const other = (
        await f.db.query('select create_tenant($1,$2,$3) id', [
          'Other synthetic store',
          `other-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      await f.db.query('select set_active_tenant($1)', [other])
    })
    const refused = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'setLabelFormat',
    )
    await row
      .getByRole('button', { name: d.printing.saveFormat, exact: true })
      .click()
    const reply = await refused
    expect(reply.status()).toBe(409)
    expect((await reply.json()).error).toBe('TENANT_CHANGED')
    await expect(row.getByRole('alert')).toHaveText(d.intake.changed)
    await expectInsideViewport(page, {
      width,
      height,
      alert: row.getByRole('alert'),
      save: row.getByRole('button', {
        name: d.printing.saveFormat,
        exact: true,
      }),
      reload: row.getByRole('button', { name: d.intake.reload, exact: true }),
    })
    await page.screenshot({
      path: 'private/label-size-320-stale.png',
      caret: 'initial',
    })
    await expect(width).toBeDisabled()
    await expect(height).toBeDisabled()
    await expect(
      row.getByRole('button', { name: d.printing.saveFormat, exact: true }),
    ).toBeDisabled()
    const reload = row.getByRole('button', {
      name: d.intake.reload,
      exact: true,
    })
    await expect(reload).toBeVisible()
    await reload.click()
    await expect(page).toHaveURL(/\/settings\?tab=printing$/)
    // Nothing was written for the original store.
    expect(
      (
        await f.db.query(
          'select count(*)::int n from label_formats where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
