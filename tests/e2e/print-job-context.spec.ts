import { expectDetailTarget } from '../helpers/detail-target'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('print history identifies its item and printer and can inspect a job beyond the recent list', async ({
  page,
}, testInfo) => {
  const email = `print-history-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let releaseScripts = () => {}
  try {
    const items = [
      await f.item('Synthetic coat label'),
      await f.item('Synthetic lamp label'),
    ]
    const printers = [randomUUID(), randomUUID()]
    for (const [index, id] of printers.entries())
      await f.db.query(
        "select register_printer($1,$2,$3,'tcp','127.0.0.1:9100','Synthetic',203,true)",
        [f.tenant, id, `Synthetic printer ${index + 1}`],
      )
    await f.commit()
    async function queue(index: number) {
      const requestId = randomUUID()
      const response = await page.request.post('/api/print', {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          tenantId: f.tenant,
          requestId,
          printerId: printers[index],
          kind: 'item',
          referenceKind: 'item',
          referenceId: items[index],
          copies: 1,
        },
      })
      expect(response.status()).toBe(200)
      return requestId
    }
    const jobs = [await queue(0), await queue(1)]
    await page.setViewportSize({ width: 320, height: 720 })
    const scripts = new Promise<void>((resolve) => {
      releaseScripts = resolve
    })
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.goto('/settings?tab=printing#print-jobs', {
      waitUntil: 'commit',
    })
    // Native fragment scrolling cannot find a hidden panel before hydration.
    await expect(
      page.getByRole('tab', { name: d.printing.tabs.history, exact: true }),
    ).toBeDisabled()
    await expect(page.locator('#print-jobs')).toBeHidden()
    releaseScripts()
    await expect(page.locator('#print-jobs')).toBeInViewport()
    await page.unroute(/\/_next\/.*\.js(?:\?.*)?$/)
    for (const [index, id] of jobs.entries()) {
      const row = page.locator(`#print-job-${id}`)
      await expect(row).toContainText(`Synthetic printer ${index + 1}`)
      const source = row.getByRole('link', {
        name: `I-${items[index].slice(0, 8).toUpperCase()}`,
      })
      await expectDetailTarget(source, `/intake/items/${items[index]}`)
      await expect(row).toContainText(d.printing.statuses.queued)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    // Move the first job beyond both the displayed 20 and the newest-50 read.
    for (let index = 0; index < 50; index++) await queue(1)
    // Navigating to the same URL with a fragment does not reload its data.
    await page.reload()
    await expect(page.locator(`#print-job-${jobs[0]}`)).toHaveCount(0)
    await page.goto(`/settings?tab=printing&job=${jobs[0]}#selected-print-job`)
    const selected = page.getByRole('region', {
      name: d.printing.selectedJob,
      exact: true,
    })
    await expect(selected.locator(`#print-job-${jobs[0]}`)).toBeVisible()
    await expect(selected).toContainText('Synthetic printer 1')
    await expect(page.locator('#selected-print-job')).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('selected-print-job-mobile.png'),
    })
    await selected.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/intake/items/${items[0]}$`))
    await expect(page.getByText('Synthetic coat label').first()).toBeVisible()
    // Another store may belong to the same owner; an active-store read still
    // must not show the original store's requested job or printer.
    await f.asActor(f.actor, async () => {
      const other = (
        await f.db.query('select create_tenant($1,$2,$3) id', [
          'Other synthetic print store',
          `print-context-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      await f.db.query('select set_active_tenant($1)', [other])
    })
    for (const id of [jobs[0], randomUUID(), 'not-a-job']) {
      await page.goto(`/settings?tab=printing&job=${id}#selected-print-job`)
      const missing = page.getByRole('region', {
        name: d.printing.selectedJob,
        exact: true,
      })
      await expect(missing.getByRole('status')).toHaveText(
        d.printing.jobUnavailable,
      )
      await expect(page.locator(`#print-job-${jobs[0]}`)).toHaveCount(0)
      await expect(
        page.getByText('Synthetic printer 1', { exact: true }),
      ).toHaveCount(0)
    }
  } finally {
    releaseScripts()
    await page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})
