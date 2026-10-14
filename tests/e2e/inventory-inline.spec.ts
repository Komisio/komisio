import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('inventory edits a complete row with safe retry and selects only the current page', async ({
  page,
}, testInfo) => {
  const email = `inline-${randomUUID()}@example.test`
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 26; i++)
      await f.item('Synthetic inline item ' + String(i).padStart(2, '0'))
    const group = randomUUID()
    await f.db.query('select create_assortment_group($1,$2,$3)', [
      f.tenant,
      group,
      'Standard',
    ])
    await f.commit()
    await page.goto('/intake/items')
    const rows = page.locator('.inventory-table tbody tr'),
      all = page.getByRole('checkbox', {
        name: d.itemWorkflow.selectAll,
        exact: true,
      })
    await expect(rows).toHaveCount(25)
    await expect
      .poll(async () => (await rows.first().boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(50)
    await all.check()
    await expect(rows.locator('input[type=checkbox]:checked')).toHaveCount(25)
    await rows.first().getByRole('checkbox').uncheck()
    expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(
      true,
    )
    await all.check()
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows.locator('input[type=checkbox]:checked')).toHaveCount(0)
    await all.check()
    await expect(rows.locator('input[type=checkbox]:checked')).toHaveCount(1)
    await all.uncheck()
    await expect(rows.locator('input[type=checkbox]:checked')).toHaveCount(0)
    const row = rows.first(),
      original = await row.locator('.inventory-item-link').innerText()
    await row
      .getByRole('button', {
        name: `${d.itemWorkflow.editRow}: ${original}`,
        exact: true,
      })
      .click()
    await row
      .getByLabel(d.itemWorkflow.description, { exact: true })
      .fill('Cancelled title')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page
      .getByRole('link', { name: d.items.previousPage, exact: true })
      .click()
    await expect(
      row.getByLabel(d.itemWorkflow.description, { exact: true }),
    ).toHaveValue('Cancelled title')
    await row
      .getByRole('button', { name: d.itemWorkflow.cancel, exact: true })
      .click()
    await expect(row.locator('.inventory-item-link')).toHaveText(original)
    await row
      .getByRole('button', {
        name: `${d.itemWorkflow.editRow}: ${original}`,
        exact: true,
      })
      .click()
    await row
      .getByLabel(d.itemWorkflow.description, { exact: true })
      .fill('Synthetic edited coat')
    await row
      .getByLabel(d.quickIntake.category, { exact: true })
      .fill('Outerwear')
    await row
      .getByLabel(d.quickIntake.itemType, { exact: true })
      .selectOption('sweater')
    await row
      .getByLabel(d.itemWorkflow.group, { exact: true })
      .selectOption(group)
    await page.screenshot({
      path: testInfo.outputPath('inventory-editing.png'),
      fullPage: true,
    })
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/items/row', async (route) => {
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1) return route.fulfill({ status: 503, json: {} })
      return route.fulfill({ response })
    })
    await row
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(row.getByRole('status')).toHaveText(d.itemWorkflow.uncertain)
    await expect(
      row.getByLabel(d.itemWorkflow.description, { exact: true }),
    ).toBeDisabled()
    await expect(
      row.getByRole('button', { name: d.itemWorkflow.cancel, exact: true }),
    ).toBeDisabled()
    await row
      .getByRole('button', { name: d.itemWorkflow.retry, exact: true })
      .click()
    await expect(row.locator('.inventory-item-link')).toHaveText(
      'Synthetic edited coat',
    )
    await expect(row).toContainText('Outerwear')
    await expect(row).toContainText('Standard')
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(
      Number(
        (
          await f.db.query(
            'select count(*) n from item_attribute_corrections where item_id=$1',
            [commands[0].itemId],
          )
        ).rows[0].n,
      ),
    ).toBe(2)
    await page.screenshot({
      path: testInfo.outputPath('inventory-inline.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
