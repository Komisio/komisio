import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('inline price replays once without a reason, while drop-off title editing stays in the same list', async ({
  page,
}, testInfo) => {
  const email = `inline-price-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic typo jacket')
    const bag = (
      await f.db.query(
        'select bag_id from reception_sessions where tenant_id=$1 and bag_id is not null limit 1',
        [f.tenant],
      )
    ).rows[0].bag_id
    await f.commit()
    await page.goto('/intake/items')
    const row = page.locator(`#inventory-item-${item}`)
    await expect(row).toBeVisible()
    const headers = await page
      .locator('.inventory-table thead tr')
      .last()
      .getByRole('columnheader')
      .allTextContents()
    expect(headers.slice(1, 5).map((s) => s.trim())).toEqual([
      d.items.item,
      d.quickIntake.category,
      d.quickIntake.itemType,
      d.quickIntake.price,
    ])
    await row
      .getByRole('button', {
        name: `${d.priceEdit.title}: Synthetic typo jacket`,
      })
      .click()
    const dialog = page.getByRole('dialog', {
      name: d.priceEdit.title,
      exact: true,
    })
    await dialog
      .getByLabel(`${d.lifecycle.price} (SEK)`, { exact: true })
      .fill('149,95')
    const sent: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const body = route.request().postDataJSON()
      if (body.action !== 'setItemPrice') return route.continue()
      sent.push(body)
      const response = await route.fetch()
      if (sent.length === 1) return route.abort('failed')
      await route.fulfill({ response })
    })
    await dialog
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: d.cancel, exact: true }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    const refreshed = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname === '/intake/items' &&
        r.request().headers()['rsc'] === '1',
    )
    await dialog
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    // Refresh streams can stay open for postponed content. Wait for the
    // application transition below, rather than the lifetime of the stream.
    await refreshed
    await expect(
      page.getByRole('combobox', { name: d.activeTenant, exact: true }),
    ).toBeEnabled()
    await expect(dialog).not.toBeVisible()
    await expect(row.locator('.inventory-price')).toContainText('149,95 kr')
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from item_events where item_id=$1 and kind='price_set' and detail->>'reason'=''",
          [item],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.goto(`/intake/bags/${bag}/inspect#bag-registered`)
    const received = page.locator(`#inventory-item-${item}`)
    await received.locator('.inventory-item-link').click()
    const description = received.getByRole('textbox', {
      name: d.items.item,
      exact: true,
    })
    await description.fill('Synthetic corrected jacket')
    await description.press('Enter')
    await expect(received.locator('.inventory-item-link')).toContainText(
      'Synthetic corrected jacket',
    )
    await received
      .getByRole('button', {
        name: `${d.priceEdit.title}: Synthetic corrected jacket`,
      })
      .click()
    await dialog
      .getByLabel(`${d.lifecycle.price} (SEK)`, { exact: true })
      .fill('125')
    await dialog
      .getByLabel(d.priceEdit.reason, { exact: true })
      .selectOption('defect')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: testInfo.outputPath('inline-price-mobile.png'),
      fullPage: true,
    })
    const box = await dialog.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    await dialog
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(dialog).not.toBeVisible()
    await expect(received.locator('.inventory-price')).toContainText(
      '125,00 kr',
    )
    expect(
      (
        await f.db.query(
          "select detail->>'reason' reason from item_events where item_id=$1 and kind='price_set' and detail->>'priceOre'='12500'",
          [item],
        )
      ).rows[0].reason,
    ).toBe(d.priceEdit.defect)
  } finally {
    await f.close()
  }
})

test('inline price refuses a stale list and bulk price permits an omitted reason', async ({
  page,
}) => {
  const email = `price-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic stale price')
    await f.commit()
    await page.goto('/intake/items')
    const row = page.locator(`#inventory-item-${item}`)
    await row
      .getByRole('button', {
        name: `${d.priceEdit.title}: Synthetic stale price`,
      })
      .click()
    let dialog = page.getByRole('dialog', {
      name: d.priceEdit.title,
      exact: true,
    })
    await dialog
      .getByLabel(`${d.lifecycle.price} (SEK)`, { exact: true })
      .fill('170')
    await f.asActor(f.actor, () =>
      f.db.query(
        "select set_item_price($1,$2,$3,18000,'Concurrent store decision')",
        [f.tenant, randomUUID(), item],
      ),
    )
    await dialog
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    await dialog
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(row.locator('.inventory-price')).toContainText('180,00 kr')
    await row.getByRole('checkbox').check()
    await page
      .getByRole('button', { name: d.itemLifecycleBatch.title, exact: true })
      .click()
    dialog = page.getByRole('dialog', { name: d.itemLifecycleBatch.title })
    await dialog
      .getByLabel(d.itemPeriod.operation, { exact: true })
      .selectOption('setPrice')
    await dialog
      .getByLabel(`${d.lifecycle.price} (SEK)`, { exact: true })
      .fill('160')
    await dialog
      .getByRole('button', { name: d.itemLifecycleBatch.preview, exact: true })
      .click()
    await dialog
      .getByRole('button', { name: d.itemLifecycleBatch.apply, exact: true })
      .click()
    await expect(dialog.getByRole('status')).toContainText(
      `1 ${d.itemLifecycleBatch.applied}`,
    )
    expect(
      (
        await f.db.query(
          "select detail->>'reason' reason from item_events where item_id=$1 and kind='price_set' and detail->>'priceOre'='16000'",
          [item],
        )
      ).rows[0].reason,
    ).toBe('')
  } finally {
    await f.close()
  }
})
