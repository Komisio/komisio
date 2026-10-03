import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function decide(
  page: Page,
  message: string,
  accept: boolean,
  action: () => Promise<unknown>,
) {
  const prompt = page.waitForEvent('dialog')
  const triggered = action()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(message)
  if (accept) await dialog.accept()
  else await dialog.dismiss()
  await triggered
}

test('template drafts survive cancelled kind, copy and navigation changes; confirmed saves clear the warning', async ({
  page,
}) => {
  const email = `template-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=printing')
    const summary = page.locator('.label-templates-fold > summary')
    await summary.click()
    const editor = page.locator('.label-template-editor')
    const name = editor.locator('input')
    const zpl = editor.locator('textarea')
    const kind = page.locator('#template-kind')
    const content = '^XA^FO10,10^FD{reference} draft^FS^XZ'
    await name.fill('Synthetic template draft')
    await zpl.fill(content)
    await decide(page, d.printing.discardTemplate, false, () =>
      kind.selectOption('bag'),
    )
    await expect(kind).toHaveValue('item')
    await expect(name).toHaveValue('Synthetic template draft')
    await expect(zpl).toHaveValue(content)
    await decide(page, d.printing.discardTemplate, false, () =>
      editor
        .getByRole('button', { name: d.printing.copyBuiltin, exact: true })
        .click(),
    )
    await expect(zpl).toHaveValue(content)
    await summary.click()
    const other = page.locator('.view-tab[href="/settings"]')
    await decide(page, d.leaveUnsaved, false, () => other.click())
    await summary.click()
    await expect(zpl).toHaveValue(content)
    await editor
      .getByRole('button', { name: d.printing.saveTemplate, exact: true })
      .click()
    await expect(editor).toContainText(`${d.printing.templateVersion} 1`)
    await expect(zpl).toBeEnabled()
    await expect(name).toHaveValue('Synthetic template draft')
    await name.fill('Later unsubmitted name')
    await decide(page, d.printing.discardTemplate, false, () =>
      kind.selectOption('bag'),
    )
    await name.fill('Synthetic template draft')
    let warnings = 0
    const unexpected = async (dialog: import('@playwright/test').Dialog) => {
      warnings++
      await dialog.dismiss()
    }
    page.on('dialog', unexpected)
    await other.click()
    await expect(page).toHaveURL('/settings')
    expect(warnings).toBe(0)
    page.off('dialog', unexpected)
    await page.goto('/settings?tab=printing')
    await summary.click()
    await zpl.fill(content + ' unsaved')
    await decide(page, d.printing.discardTemplate, true, () =>
      kind.selectOption('bag'),
    )
    await expect(kind).toHaveValue('bag')
    await expect(zpl).toHaveValue('')
    await other.click()
    await expect(page).toHaveURL('/settings')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from label_templates where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
