import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('blank row space opens the item while row controls keep their own actions', async ({
  page,
}) => {
  const email = `row-open-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic clickable item')
    await f.commit()
    await page.goto('/intake/items')
    const row = page.locator('.inventory-row')
    await row.getByRole('checkbox').check()
    await expect(row.getByRole('checkbox')).toBeChecked()
    await expect(page).toHaveURL(/\/intake\/items$/)
    await row.locator('.inventory-item-link').click()
    await expect(
      row.getByRole('textbox', { name: d.items.item, exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await row
      .getByRole('button', {
        name: d.items.ownershipKinds.consignment,
        exact: true,
      })
      .click()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.getByRole('tooltip').click()
    await expect(page).toHaveURL(/\/intake\/items$/)
    await page.keyboard.press('Escape')
    // This is the empty photo/indicator cell between the title and category.
    await row.locator('td').nth(1).click()
    await expect(page).toHaveURL(new RegExp(`/intake/items/${item}$`))
    await page.goBack()
    const seller = row.locator('.inventory-seller')
    const sellerHref = await seller.getAttribute('href')
    await seller.click()
    await expect(page).toHaveURL(new RegExp(`${sellerHref}$`))
    await page.goBack()
    await row.locator('.inventory-open-item').focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/intake/items/${item}$`))
  } finally {
    await f.close()
  }
})

test('inventory workspace selects page items and saves cells with safe retry and conflict handling', async ({
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
    const rows = page.locator('.inventory-table tbody tr')
    const all = page.getByRole('checkbox', {
      name: d.itemWorkflow.selectAll,
      exact: true,
    })
    const toolbar = page.locator('.inventory-selection-toolbar')
    await expect(rows).toHaveCount(25)
    await expect(toolbar).toHaveCount(0)
    await expect
      .poll(async () => (await rows.first().boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(50)
    await rows.first().getByRole('checkbox').check()
    await expect(toolbar).toContainText(d.inventoryWorkspace.selectedOne)
    await expect(
      toolbar.getByRole('link', {
        name: d.inventoryWorkspace.open,
        exact: true,
      }),
    ).toBeVisible()
    await all.check()
    await expect(rows.locator('input[type=checkbox]:checked')).toHaveCount(25)
    await expect(toolbar).toContainText('25 markerade')
    await expect(
      toolbar.getByRole('link', {
        name: d.inventoryWorkspace.open,
        exact: true,
      }),
    ).toHaveCount(0)
    await rows.first().getByRole('checkbox').uncheck()
    expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(
      true,
    )
    await all.check()
    await toolbar
      .getByRole('button', {
        name: d.inventoryWorkspace.editSelected,
        exact: true,
      })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveCount(25)
    await expect(dialog).toContainText('Synthetic inline item')
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
    await expect(rows.first()).toContainText('Standard')
    expect(new URL(page.url()).pathname).toBe('/intake/items')
    await page.screenshot({
      path: testInfo.outputPath('inventory-selection.png'),
      fullPage: true,
    })
    await toolbar
      .getByRole('button', { name: d.labelSheets.title, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: d.labelSheets.title, exact: true }),
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.getAll('item')).toHaveLength(25)
    await page.goto('/intake/items?page=2')
    await expect(rows).toHaveCount(1)
    await expect(toolbar).toHaveCount(0)
    await all.check()
    await expect(toolbar).toContainText(d.inventoryWorkspace.selectedOne)
    await toolbar
      .getByRole('button', { name: d.inventoryWorkspace.clear, exact: true })
      .click()
    await expect(toolbar).toHaveCount(0)

    const row = rows.first(),
      name = row.locator('.inventory-item-link')
    const original = await name.innerText()
    const commands: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/items/row'))
        commands.push(request.postDataJSON())
    })
    await name.click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Cancelled title')
    await page.keyboard.press('Escape')
    await expect(name).toHaveText(original)
    await expect(name).toBeFocused()
    expect(commands).toHaveLength(0)
    await name.click()
    await page.keyboard.press('Tab')
    await expect(
      row.getByRole('combobox', { name: d.quickIntake.category, exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Escape')
    expect(commands).toHaveLength(0)
    await name.click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill(' ')
    await page.keyboard.press('Enter')
    await expect(row.getByRole('status')).toHaveText(
      d.inventoryWorkspace.invalid,
    )
    expect(commands).toHaveLength(0)
    await page.keyboard.press('Escape')
    await name.click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Synthetic edited coat')
    await page.keyboard.press('Enter')
    await expect(name).toHaveText('Synthetic edited coat')
    await expect(name).toBeFocused()
    await row
      .getByRole('button', {
        name: new RegExp(
          '^' + d.itemWorkflow.editRow + ' ' + d.quickIntake.category + ':',
        ),
      })
      .click()
    await row
      .getByRole('combobox', { name: d.quickIntake.category, exact: true })
      .selectOption('Clothing')
    // Clicking the next cell while blur saves queues that editor, preserving the new snapshot.
    await row
      .getByRole('button', {
        name: new RegExp(
          '^' + d.itemWorkflow.editRow + ' ' + d.quickIntake.itemType + ':',
        ),
      })
      .click()
    await row
      .getByRole('combobox', { name: d.quickIntake.itemType, exact: true })
      .selectOption('jacket')
    await page.keyboard.press('Tab')
    await expect(row).toContainText('Kläder')
    await expect(
      row.getByRole('combobox', { name: d.itemWorkflow.group, exact: true }),
    ).toBeFocused()
    await row
      .getByRole('combobox', { name: d.itemWorkflow.group, exact: true })
      .selectOption(group)
    await page.keyboard.press('Enter')
    await expect(row.getByRole('combobox')).toHaveCount(0)
    await expect(row).toContainText('Standard')
    expect(commands).toHaveLength(4)
    expect(
      commands.map(
        (command) => (command.expected as { version: number }).version,
      ),
    ).toEqual([0, 1, 2, 3])

    const retries: Record<string, unknown>[] = []
    await page.route('**/api/items/row', async (route) => {
      retries.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill(
        retries.length === 1 ? { status: 503, json: {} } : { response },
      )
    })
    await name.click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Synthetic retry coat')
    await page.keyboard.press('Enter')
    await expect(row.getByRole('status')).toHaveText(d.itemWorkflow.uncertain)
    await expect(row.getByRole('textbox')).toHaveAttribute('readonly', '')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page
      .getByRole('link', { name: d.items.previousPage, exact: true })
      .click()
    await expect(row.getByRole('status')).toHaveText(d.itemWorkflow.uncertain)
    await row
      .getByRole('button', { name: d.itemWorkflow.retry, exact: true })
      .click()
    await expect(name).toHaveText('Synthetic retry coat')
    expect(retries).toHaveLength(2)
    expect(retries[1]).toEqual(retries[0])
    expect(
      Number(
        (
          await f.db.query(
            'select count(*) n from item_attribute_corrections where item_id=$1',
            [retries[0].itemId],
          )
        ).rows[0].n,
      ),
    ).toBe(10)
    await page.unroute('**/api/items/row')
    await page.screenshot({
      path: testInfo.outputPath('inventory-cells.png'),
      fullPage: true,
    })
    await all.check()
    await page.setViewportSize({ width: 320, height: 820 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await toolbar
      .getByRole('button', {
        name: d.inventoryWorkspace.editSelected,
        exact: true,
      })
      .click()
    const box = await dialog.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(320)
    await page.screenshot({
      path: testInfo.outputPath('inventory-batch-mobile.png'),
      fullPage: true,
    })
    await dialog
      .getByRole('button', { name: d.printing.close, exact: true })
      .click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await name.click()
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Stale title')
    const competingEdit = await page.request.post('/api/items/description', {
      headers: { origin: new URL(page.url()).origin },
      data: {
        tenantId: f.tenant,
        requestId: randomUUID(),
        itemId: retries[0].itemId,
        expected: 'Synthetic retry coat',
        title: 'Concurrent title',
      },
    })
    expect(competingEdit.ok()).toBe(true)
    await page.keyboard.press('Enter')
    await expect(row.getByRole('status')).toHaveText(d.itemWorkflow.changed)
    await row
      .getByRole('button', { name: d.itemWorkflow.reload, exact: true })
      .click()
    await expect(name).toHaveText('Concurrent title')
  } finally {
    await f.close()
  }
})
