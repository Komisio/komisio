import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Only local synthetic stores and goods. A committed transfer's response is
// hidden once; retry must replay that transfer, not create another receipt.
test('a lost transfer response can be retried with its original destination and one receipt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const email = `transfer-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic transferred lamp')
    const targetName = 'Synthetic destination store'
    const target = (
      await f.db.query('select create_tenant($1,$2,$3) id', [
        targetName,
        `transfer-target-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    await f.db.query('select create_chain($1,$2,$3::uuid[])', [
      randomUUID(),
      'Synthetic transfer chain',
      [f.tenant, target],
    ])
    await f.db.query('select set_active_tenant($1)', [f.tenant])
    await f.commit()
    await page.goto(`/intake/items/${item}`)
    const form = page
      .locator('form')
      .filter({ has: page.locator('#transfer-target') })
    const destination = form.getByLabel(d.items.transferTarget, { exact: true })
    const note = form.getByLabel(d.items.transferNote, { exact: true })
    await destination.selectOption(target)
    await note.fill('Synthetic destination note')
    const requests: Record<string, unknown>[] = []
    let bagId = ''
    let firstStatus = 0
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command?.action !== 'transferItem') return route.continue()
      requests.push(command)
      if (requests.length === 1) {
        const response = await route.fetch()
        firstStatus = response.status()
        bagId = (await response.json()).id.bagId
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'REQUEST_FAILED' }),
        })
      } else await route.continue()
    })
    await form
      .getByRole('button', { name: d.items.transfer, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(d.intake.failed)
    expect(firstStatus).toBe(200)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const retry = form.getByRole('button', {
      name: d.intake.retry,
      exact: true,
    })
    await expect(retry).toBeEnabled()
    await expect(destination).toBeDisabled()
    await expect(note).toBeDisabled()
    const replay = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'transferItem',
    )
    await retry.click()
    const replayResponse = await replay
    expect(replayResponse.status()).toBe(200)
    expect((await replayResponse.json()).id).toMatchObject({
      replayed: true,
      bagId,
    })
    await expect(
      page.getByRole('status').filter({
        hasText: d.items.transferDone.replace('{store}', targetName),
      }),
    ).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0].toTenantId).toBe(target)
    expect(requests[0].note).toBe('Synthetic destination note')
    const events = await f.db.query(
      "select id, detail from item_events where tenant_id=$1 and item_id=$2 and detail->>'action'='transfer'",
      [f.tenant, item],
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].id).toBe(requests[0].requestId)
    expect(events.rows[0].detail.bagId).toBe(bagId)
    expect(
      (
        await f.db.query('select id from bag_receipts where tenant_id=$1', [
          target,
        ])
      ).rows,
    ).toEqual([{ id: bagId }])
    expect(
      (
        await f.db.query(
          'select count(*)::integer n from inspection_draft_revisions where tenant_id=$1 and bag_id=$2',
          [target, bagId],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          "select action from access_events where tenant_id=any($1::uuid[]) and action in ('item.transferred_out','item.transferred_in') order by action",
          [[f.tenant, target]],
        )
      ).rows.map((r: { action: string }) => r.action),
    ).toEqual(['item.transferred_in', 'item.transferred_out'])
  } finally {
    await f.close()
  }
})
