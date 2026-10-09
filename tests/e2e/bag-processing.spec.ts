import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff completes a drop-off, retries safely and reopens with history', async ({
  page,
}, info) => {
  const email = `bag-completion-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic completion',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    await page.goto(`/intake/bags/${bag}/inspect`)
    await page.setViewportSize({ width: 390, height: 844 })
    const processing = page.getByRole('region', {
      name: d.bagProcessing.title,
      exact: true,
    })
    await expect(processing.getByRole('status')).toHaveText(
      d.bagProcessing.open,
    )
    let dropped = false
    const ids: string[] = []
    await page.route('**/api/intake', async (route) => {
      const body = route.request().postDataJSON()
      if (body.action !== 'setBagProcessing') return route.continue()
      ids.push(body.requestId)
      const response = await route.fetch()
      if (!dropped) {
        dropped = true
        return route.abort()
      }
      await route.fulfill({ response })
    })
    await processing
      .getByRole('button', { name: d.bagProcessing.complete, exact: true })
      .click()
    await expect(processing.getByRole('alert')).toBeVisible()
    await processing
      .getByRole('button', { name: d.bagProcessing.complete, exact: true })
      .click()
    await expect(
      processing.getByRole('button', {
        name: d.bagProcessing.reopen,
        exact: true,
      }),
    ).toBeVisible()
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
    await page.screenshot({
      path: info.outputPath('completed-mobile.png'),
      fullPage: true,
    })
    await expect(
      page.getByRole('button', { name: d.bagIntake.save, exact: true }),
    ).toHaveCount(0)
    await page.reload()
    await expect(processing.getByRole('status')).toHaveText(
      d.bagProcessing.completed,
    )
    await processing
      .getByRole('button', { name: d.bagProcessing.reopen, exact: true })
      .click()
    await processing
      .getByLabel(d.bagProcessing.reason)
      .fill('Another item found')
    await processing
      .getByRole('button', { name: d.bagProcessing.reopen, exact: true })
      .click()
    await expect(processing.getByRole('status')).toHaveText(
      d.bagProcessing.open,
    )
    await expect(
      page.getByRole('button', { name: d.bagIntake.save, exact: true }),
    ).toBeVisible()
    await processing.getByText(d.bagProcessing.history, { exact: true }).click()
    await expect(
      processing.getByText('Another item found', { exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
    const history = await f.db.query(
      'select state from bag_processing_events where tenant_id=$1 and bag_id=$2 order by version',
      [f.tenant, bag],
    )
    expect(history.rows.map((r: { state: string }) => r.state)).toEqual([
      'completed',
      'open',
    ])
  } finally {
    await f.close()
  }
})
