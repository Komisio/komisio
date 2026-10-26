import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff records collection, retries an unanswered save and retains both observations', async ({
  page,
}, testInfo) => {
  const email = `collection-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic collection jacket')
    await f.db.query("select end_sale_period($1,$2,$3,'return')", [
      f.tenant,
      randomUUID(),
      item,
    ])
    await f.commit()
    // Exercise the non-owner staff permission, not only the owner path.
    const owner = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `${owner}@example.test`],
    )
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
      [f.tenant, owner],
    )
    await f.db.query(
      "update tenant_members set role='staff' where tenant_id=$1 and user_id=$2",
      [f.tenant, f.actor],
    )
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto(`/intake/items/${item}`)
    const section = page.getByRole('region', { name: d.itemCollection.title })
    await expect(section.getByTestId('collection-status')).toHaveText(
      d.itemCollection.unrecorded,
    )
    await section.locator('summary').click()
    await section
      .getByLabel(d.itemCollection.status, { exact: true })
      .selectOption('false')
    await section
      .getByLabel(d.itemCollection.note, { exact: true })
      .fill('Synthetic shelf check')
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const input = route.request().postDataJSON()
      if (input.action !== 'recordItemCollection') return route.continue()
      commands.push(input)
      const response = await route.fetch()
      if (commands.length === 1)
        await route.fulfill({ status: 502, body: 'Unconfirmed test response' })
      else await route.fulfill({ response })
    })
    await section
      .getByRole('button', { name: d.itemCollection.save, exact: true })
      .click()
    await expect(section.getByRole('alert')).toHaveText(d.intake.failed)
    await expect(
      section.getByLabel(d.itemCollection.status, { exact: true }),
    ).toBeDisabled()
    await section
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(section.getByRole('status')).toHaveText(d.itemCollection.saved)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await expect(section.getByTestId('collection-status')).toContainText(
      d.itemCollection.notCollected,
    )
    await section
      .getByLabel(d.itemCollection.status, { exact: true })
      .selectOption('true')
    await section
      .getByLabel(d.itemCollection.note, { exact: true })
      .fill('Synthetic pickup')
    await section
      .getByRole('button', { name: d.itemCollection.save, exact: true })
      .click()
    await expect(section.getByTestId('collection-status')).toContainText(
      d.itemCollection.collected,
    )
    const events = (
      await f.db.query(
        "select detail from item_events where item_id=$1 and kind='collection_recorded' order by occurred_at",
        [item],
      )
    ).rows
    expect(
      events.map(
        (row: { detail: { collected: boolean } }) => row.detail.collected,
      ),
    ).toEqual([false, true])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('item-collection-mobile.png'),
      fullPage: true,
    })
    await page
      .getByRole('tab', { name: d.itemDetail.history, exact: true })
      .click()
    const history = page.locator('details.item-detail-section').filter({
      has: page.locator('summary').filter({ hasText: d.items.events }),
    })
    await history.locator(':scope > summary').click()
    await expect(history).toContainText('Synthetic shelf check')
    await expect(history).toContainText('Synthetic pickup')
    await expect(history).toContainText(d.items.eventDetails.notCollected)
    await expect(history).toContainText(d.items.eventDetails.collected)
    await page
      .getByRole('tab', { name: d.itemDetail.overview, exact: true })
      .click()
    // Another screen saves after this page's latest read.
    await f.asActor(f.actor, async () => {
      await f.db.query(
        "select record_item_collection($1,$2,$3,$4,$5,true,(now() at time zone 'Europe/Stockholm')::date,'Synthetic concurrent check')",
        [
          f.tenant,
          randomUUID(),
          item,
          commands[2].endEventId,
          commands[2].requestId,
        ],
      )
    })
    await section
      .getByLabel(d.itemCollection.status, { exact: true })
      .selectOption('false')
    await section
      .getByRole('button', { name: d.itemCollection.save, exact: true })
      .click()
    await expect(section.getByRole('alert')).toHaveText(d.intake.recordChanged)
    await expect(
      section.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await expect(
      section.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    // Read-only staff see evidence but no collection mutation control.
    await f.db.query(
      "update tenant_members set role='readonly' where tenant_id=$1 and user_id=$2",
      [f.tenant, f.actor],
    )
    await page.goto(`/intake/items/${item}`)
    await expect(section.getByTestId('collection-status')).toContainText(
      d.itemCollection.collected,
    )
    await expect(section.locator('form')).toHaveCount(0)
  } finally {
    await f.close()
  }
})
