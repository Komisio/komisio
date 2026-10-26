import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff corrects an end action and safely reopens an item on a narrow screen', async ({
  page,
}, testInfo) => {
  const email = `reopen-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic reopened jacket')
    await f.db.query(
      "select end_sale_period($1,$2,$3,'charity','Synthetic mistaken end')",
      [f.tenant, randomUUID(), item],
    )
    await f.commit()
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
    const until = (
      await f.db.query(
        "select ((now() at time zone 'Europe/Stockholm')::date+14)::text as ends_on",
      )
    ).rows[0].ends_on
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto(`/intake/items/${item}`)
    const section = page.getByRole('region', { name: d.itemPeriod.title })
    await section.locator('summary').click()
    await section
      .getByLabel(d.itemPeriod.operation, { exact: true })
      .selectOption('correct')
    await section
      .getByLabel(d.itemPeriod.endAction, { exact: true })
      .selectOption('return')
    await section
      .getByLabel(d.itemPeriod.reason, { exact: true })
      .fill('Synthetic correction to seller return')
    await section.getByRole('checkbox').check()
    await section
      .getByRole('button', { name: d.itemPeriod.save, exact: true })
      .click()
    await expect(section.getByRole('status')).toHaveText(d.itemPeriod.saved)
    await expect(
      page.getByRole('region', { name: d.itemCollection.title }),
    ).toBeVisible()
    await section
      .getByLabel(d.itemPeriod.operation, { exact: true })
      .selectOption('reopen')
    await section
      .getByLabel(d.itemPeriod.saleEndsOn, { exact: true })
      .fill(until)
    await section
      .getByLabel(d.itemPeriod.reason, { exact: true })
      .fill('Synthetic new selling period')
    await expect(section).toContainText(d.itemPeriod.noFee)
    await page.screenshot({
      path: testInfo.outputPath('reopen-item-mobile.png'),
      fullPage: true,
    })
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const input = route.request().postDataJSON()
      if (input.action !== 'reopenItemPeriod') return route.continue()
      commands.push(input)
      const response = await route.fetch()
      if (commands.length === 1)
        await route.fulfill({ status: 502, body: 'Synthetic lost response' })
      else await route.fulfill({ response })
    })
    await section
      .getByRole('button', { name: d.itemPeriod.save, exact: true })
      .click()
    await expect(section.getByRole('alert')).toHaveText(d.intake.failed)
    await expect(
      section.getByLabel(d.itemPeriod.saleEndsOn, { exact: true }),
    ).toBeDisabled()
    await section
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(section).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await expect(
      page.getByRole('link', { name: d.sales.markSold, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: d.itemCollection.title }),
    ).toHaveCount(0)
    await page
      .getByRole('tab', { name: d.itemDetail.history, exact: true })
      .click()
    const history = page.locator('details.item-detail-section').filter({
      has: page.locator('summary').filter({ hasText: d.items.events }),
    })
    await history.locator(':scope > summary').click()
    await expect(history).toContainText(d.items.eventKinds.period_reopened)
    await expect(history).toContainText(d.items.eventKinds.period_end_corrected)
    await expect(history).toContainText('Synthetic mistaken end')
    await expect(history).toContainText('Synthetic new selling period')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from item_events where item_id=$1 and kind='period_reopened'",
          [item],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
