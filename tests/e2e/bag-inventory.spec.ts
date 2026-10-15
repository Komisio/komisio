import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('handover shares inline edits, selection and print actions without losing reception work', async ({
  page,
}, info) => {
  const email = `bag-table-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Synthetic unrelated bag')
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        '',
        f.agreement,
      ])
    ).rows[0].id
    for (const title of ['Synthetic coat', 'Synthetic jacket']) {
      const draft = randomUUID()
      await f.db.query(
        'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
        [f.tenant, randomUUID(), bag, draft, title, 'Clothing', 'Good'],
      )
      await f.db.query(
        "select accept_item($1,$2,'reception_review',$3,1,20000)",
        [f.tenant, randomUUID(), draft],
      )
    }
    const group = randomUUID()
    await f.db.query('select create_assortment_group($1,$2,$3)', [
      f.tenant,
      group,
      'Synthetic selection',
    ])
    await f.commit()
    await page.goto(`/intake/bags/${bag}/inspect`)
    const table = page.locator('#bag-registered')
    const rows = table.locator('.inventory-row')
    await expect(rows).toHaveCount(2)
    await expect(table.locator('.inventory-filters')).toHaveCount(0)
    await expect(table).not.toContainText('Synthetic unrelated bag')
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic unsaved next item')
    await table
      .getByRole('link', {
        name: `${d.items.item}: ${d.items.directory.sortAsc}`,
        exact: true,
      })
      .click()
    // The initial order may already start with the coat. Wait for the sorted
    // table itself before editing, rather than matching its pre-navigation row.
    await expect(table.locator('th[aria-sort="ascending"]')).toHaveText(
      d.items.item,
    )
    await expect(rows.first()).toContainText('Synthetic coat')
    await expect(description).toHaveValue('Synthetic unsaved next item')
    const row = rows.first()
    await row.locator('.inventory-item-link').click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Synthetic corrected coat')
    await page.keyboard.press('Enter')
    await expect(row.locator('.inventory-item-link')).toHaveText(
      'Synthetic corrected coat',
    )
    await expect(description).toHaveValue('Synthetic unsaved next item')
    await row
      .getByRole('button', {
        name: new RegExp(
          '^' + d.itemWorkflow.editRow + ' ' + d.quickIntake.category + ':',
        ),
      })
      .click()
    await row
      .getByRole('combobox', { name: d.quickIntake.category, exact: true })
      .selectOption('Home & décor')
    await page.keyboard.press('Tab')
    // The selected option is present before the save has completed. Tab opens
    // the next editor only after the category's command has been confirmed.
    await expect(
      row.getByRole('combobox', { name: d.quickIntake.itemType, exact: true }),
    ).toBeFocused()
    await expect(
      row.getByRole('button', {
        name: `${d.itemWorkflow.editRow} ${d.quickIntake.category}: Hem och inredning`,
        exact: true,
      }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      row.getByRole('combobox', { name: d.quickIntake.itemType, exact: true }),
    ).toHaveCount(0)
    // An uncertain inline save must warn before changing this table's page/sort,
    // while the independent reception draft does not block table navigation.
    let commands = 0
    await page.route('**/api/items/row', async (route) => {
      commands++
      if (commands > 1) return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    await row.locator('.inventory-item-link').click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Synthetic confirmed coat')
    await page.keyboard.press('Enter')
    await expect(row.getByRole('status')).toHaveText(d.itemWorkflow.uncertain)
    const before = page.url()
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe(d.leaveUnsaved)
      await dialog.dismiss()
    })
    await table
      .getByRole('link', {
        name: `${d.items.item}: ${d.items.directory.sortDesc}`,
        exact: true,
      })
      .click()
    await expect(page).toHaveURL(before)
    await row
      .getByRole('button', { name: d.itemWorkflow.retry, exact: true })
      .click()
    await expect(row.locator('.inventory-item-link')).toHaveText(
      'Synthetic confirmed coat',
    )
    expect(commands).toBe(2)
    await table
      .getByRole('checkbox', { name: d.itemWorkflow.selectAll, exact: true })
      .check()
    await expect(rows.locator('input[type=checkbox]:checked')).toHaveCount(2)
    await table
      .getByRole('button', {
        name: d.inventoryWorkspace.editSelected,
        exact: true,
      })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Synthetic confirmed coat')
    await dialog
      .getByLabel(d.quickIntake.itemType, { exact: true })
      .selectOption('jacket')
    await dialog
      .getByLabel(d.itemWorkflow.group, { exact: true })
      .selectOption(group)
    await dialog
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(rows.filter({ hasText: 'Synthetic selection' })).toHaveCount(2)
    await expect(description).toHaveValue('Synthetic unsaved next item')
    await table.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: info.outputPath('bag-inventory-desktop.png'),
    })
    await description.fill('')
    await table
      .getByRole('button', { name: d.labelSheets.title, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\/items\/labels\?/)
    expect(new URL(page.url()).searchParams.getAll('item')).toHaveLength(2)
  } finally {
    await f.close()
  }
})
