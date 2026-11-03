import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('compact columns fit desktop and retain optional details through paging and reload', async ({
  page,
}, info) => {
  const email = `columns-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    for (let n = 0; n < 26; n++)
      await f.item(`Synthetic long inventory title ${n}`)
    await f.commit()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/intake/items?sort=title&direction=asc')
    const table = page.locator('.inventory-table')
    const columns = table.locator('thead tr:last-child th:visible')
    await expect(columns).toHaveCount(7)
    await expect(
      table.getByRole('checkbox', {
        name: d.itemWorkflow.selectAll,
        exact: true,
      }),
    ).toBeEnabled()
    const scroll = page.locator('.inventory-table-scroll')
    expect(
      await scroll.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: info.outputPath('compact-inventory.png'),
      fullPage: true,
      caret: 'initial',
    })
    const picker = page.locator('.inventory-column-picker')
    await picker.locator('summary').focus()
    await page.keyboard.press('Enter')
    const choices = picker.getByRole('checkbox')
    await expect(choices).toHaveCount(6)
    for (const choice of await choices.all()) await choice.check()
    await expect(columns).toHaveCount(13)
    await picker.locator('summary').click()
    await table
      .getByRole('checkbox', { name: d.itemWorkflow.selectAll, exact: true })
      .check()
    await expect(table.locator('.inventory-selection-row th')).toHaveAttribute(
      'colspan',
      '13',
    )
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(columns).toHaveCount(13)
    await page.reload()
    await expect(columns).toHaveCount(13)
    await picker.locator('summary').click()
    await expect(choices.first()).toBeChecked()
    await picker
      .getByRole('button', { name: d.items.directory.columns.reset })
      .click()
    await expect(columns).toHaveCount(7)
    await table
      .getByRole('checkbox', { name: d.itemWorkflow.selectAll, exact: true })
      .check()
    await expect(table.locator('.inventory-selection-row th')).toHaveAttribute(
      'colspan',
      '7',
    )
    // Hidden editors must not capture Tab after an unchanged title edit.
    await table.locator('.inventory-title-edit').click()
    await page.keyboard.press('Tab')
    await expect(table.getByRole('textbox')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => !!document.activeElement?.getClientRects().length,
      ),
    ).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const choice of await choices.all()) await choice.check()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
    for (const label of await picker.locator('label').all())
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({
      path: info.outputPath('inventory-columns-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    // A hidden field keeps its uncertain command and visible retry feedback.
    const row = table.locator('tbody tr').first()
    await row
      .getByRole('button', {
        name: new RegExp(
          `^${d.itemWorkflow.editRow} ${d.quickIntake.category}:`,
        ),
      })
      .click()
    const requests: unknown[] = []
    await page.route('**/api/items/row', async (route) => {
      requests.push(route.request().postDataJSON())
      if (requests.length === 1) await route.abort()
      else await route.continue()
    })
    await row
      .getByRole('combobox', { name: d.quickIntake.category, exact: true })
      .selectOption({ label: 'Hem och inredning' })
    await page.keyboard.press('Enter')
    await expect(row.getByRole('status')).toHaveText(d.itemWorkflow.uncertain)
    await choices.first().uncheck()
    await expect(row.getByRole('status')).toBeVisible()
    await row
      .getByRole('button', { name: d.itemWorkflow.retry, exact: true })
      .click()
    await expect(row.getByRole('status')).toHaveText(d.inventoryWorkspace.saved)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
  } finally {
    await f.close()
  }
})

test('column preferences ignore other stores and malformed or unavailable storage', async ({
  page,
}) => {
  const email = `columns-storage-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Synthetic storage item')
    await f.commit()
    await page.evaluate(() =>
      localStorage.setItem(
        'komisio-inventory-columns:another-store',
        '["category"]',
      ),
    )
    await page.goto('/intake/items')
    const columns = page.locator(
      '.inventory-table thead tr:last-child th:visible',
    )
    await expect(columns).toHaveCount(7)
    await page.evaluate(
      (key) => localStorage.setItem(key, 'malformed'),
      `komisio-inventory-columns:${f.tenant}`,
    )
    await page.reload()
    const picker = page.locator('.inventory-column-picker')
    await picker.locator('summary').click()
    await expect(picker.getByRole('checkbox').first()).toBeEnabled()
    await expect(columns).toHaveCount(7)
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('Storage blocked')
      }
      Storage.prototype.setItem = () => {
        throw new Error('Storage blocked')
      }
    })
    await page.reload()
    await picker.locator('summary').click()
    await picker.getByRole('checkbox').first().check()
    await expect(columns).toHaveCount(8)
    await picker
      .getByRole('button', { name: d.items.directory.columns.reset })
      .click()
    await expect(columns).toHaveCount(7)
  } finally {
    await f.close()
  }
})
