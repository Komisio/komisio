import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('bulk preview skips ended and changed items and safely retries a lost response on iPad', async ({
  page,
}, testInfo) => {
  const email = `bulk-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const first = await f.item('Synthetic bulk first'),
      ended = await f.item('Synthetic bulk ended'),
      changed = await f.item('Synthetic bulk changed')
    await f.db.query("select end_sale_period($1,$2,$3,'return')", [
      f.tenant,
      randomUUID(),
      ended,
    ])
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake/lifecycle')
    await page.getByRole('checkbox', { name: d.itemWorkflow.selectAll }).check()
    await page
      .getByRole('button', { name: d.itemLifecycleBatch.title, exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: d.itemLifecycleBatch.title,
    })
    await dialog
      .getByLabel(d.itemPeriod.operation, { exact: true })
      .selectOption('extend')
    await dialog.getByLabel(d.lifecycle.days, { exact: true }).fill('5')
    await dialog
      .getByLabel(d.lifecycle.reason, { exact: true })
      .fill('Synthetic bulk browser extension')
    await dialog
      .getByRole('button', { name: d.itemLifecycleBatch.preview, exact: true })
      .click()
    await expect(dialog).toContainText(d.itemLifecycleBatch.reasons.ended)
    await f.asActor(f.actor, () =>
      f.db.query(
        "select set_item_price($1,$2,$3,19000,'Concurrent browser test')",
        [f.tenant, randomUUID(), changed],
      ),
    )
    const commands: unknown[] = []
    let lost = false
    await page.route('**/api/items/lifecycle-batch', async (route) => {
      const input = route.request().postDataJSON()
      if (input.action === 'apply') {
        commands.push(input)
        const response = await route.fetch()
        if (!lost) {
          lost = true
          await route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: '{}',
          })
          return
        }
        await route.fulfill({ response })
        return
      }
      await route.continue()
    })
    await dialog
      .getByRole('button', { name: d.itemLifecycleBatch.apply, exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toHaveText(d.itemWorkflow.uncertain)
    await dialog
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(dialog.getByRole('status')).toContainText(
      `1 ${d.itemLifecycleBatch.applied}`,
    )
    await expect(dialog).toContainText(d.itemLifecycleBatch.reasons.changed)
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from item_events where tenant_id=$1 and kind='period_extended' and detail->>'reason'='Synthetic bulk browser extension'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from item_events where item_id=$1 and kind='period_extended'",
          [first],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('lifecycle-batch-mobile.png'),
    })
    await dialog
      .getByRole('button', { name: d.printing.close, exact: true })
      .click()
    await expect(page.locator(`#lifecycle-${changed}`)).toContainText(
      '190.00 SEK',
    )
    await page.locator('a[href="/intake/items"]:visible').first().click()
    await expect(page).toHaveURL(/\/intake\/items$/)
    await page.getByRole('checkbox', { name: d.itemWorkflow.selectAll }).check()
    await page
      .getByRole('button', { name: d.itemLifecycleBatch.title, exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: d.itemLifecycleBatch.title }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
