import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelLeave(page: Page, target: Locator) {
  const prompt = page.waitForEvent('dialog')
  const click = target.click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

for (const kind of ['printer', 'dimensions'] as const) {
  test(`${kind} drafts survive cancelled departure and reverting releases the warning`, async ({
    page,
  }) => {
    const email = `printing-draft-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.goto('/settings?tab=printing')
      if (kind === 'dimensions')
        await page.locator('.label-formats-fold > summary').click()
      const field =
        kind === 'printer'
          ? page.locator('input[name="name"]').first()
          : page.locator('.label-format input').first()
      const original = await field.inputValue()
      await field.fill(kind === 'printer' ? 'Synthetic printer draft' : '62')
      const link = page.locator('.view-tab[href="/settings"]')
      await cancelLeave(page, link)
      await expect(page).toHaveURL('/settings?tab=printing')
      await expect(field).toHaveValue(
        kind === 'printer' ? 'Synthetic printer draft' : '62',
      )
      await field.fill(original)
      let warnings = 0
      page.on('dialog', async (dialog) => {
        warnings++
        await dialog.dismiss()
      })
      await link.click()
      await expect(page).toHaveURL('/settings')
      expect(warnings).toBe(0)
    } finally {
      await f.close()
    }
  })
}

test('saving one printing form preserves another draft and establishes the confirmed baseline', async ({
  page,
}) => {
  const email = `printing-baseline-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select register_printer($1,$2,$3,$4,$5,$6,$7,$8)', [
      f.tenant,
      randomUUID(),
      'Synthetic existing printer',
      'usb',
      '',
      '',
      203,
      true,
    ])
    await f.commit()
    await page.goto('/settings?tab=printing')
    await page
      .locator('summary')
      .filter({ hasText: 'Synthetic existing printer' })
      .click()
    const form = page
      .locator('form')
      .filter({ has: page.locator('input[name="name"]') })
      .first()
    const name = form.locator('input[name="name"]')
    await name.fill('Synthetic updated printer')
    await page.locator('.label-formats-fold > summary').click()
    const row = page.locator('.label-format').first()
    const width = row.locator('input').first()
    await width.fill('62')
    await form
      .getByRole('button', { name: d.printing.update, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.printing.saved)
    await expect(name).toBeEnabled()
    await name.fill('Unsubmitted later printer')
    await name.fill('Synthetic updated printer')
    const other = page.locator('.view-tab[href="/settings"]')
    await cancelLeave(page, other)
    await expect(width).toHaveValue('62')
    await row
      .getByRole('button', { name: d.printing.saveFormat, exact: true })
      .click()
    await expect(row.getByRole('status')).toHaveText(d.printing.formatSaved)
    await width.fill('64')
    await cancelLeave(page, other)
    await width.fill('62')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await other.click()
    await expect(page).toHaveURL('/settings')
    expect(warnings).toBe(0)
    expect(
      (
        await f.db.query('select name from printers where tenant_id=$1', [
          f.tenant,
        ])
      ).rows,
    ).toEqual([{ name: 'Synthetic updated printer' }])
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

test('seller terms keep edits across tabs and release navigation after confirmed publication', async ({
  page,
}) => {
  const email = `terms-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-terms`)
    await page.getByText(d.sellerProfile.editTerms, { exact: true }).click()
    const form = page
      .locator('form')
      .filter({ has: page.locator('#terms-notes') })
    const notes = form.locator('#terms-notes')
    await notes.fill('Synthetic terms draft')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.items, exact: true })
      .click()
    const other = page.locator('.sidebar a[href="/intake/sellers"]')
    await cancelLeave(page, other)
    await page
      .getByRole('tab', { name: d.sellerWorkspace.terms, exact: true })
      .click()
    await expect(notes).toHaveValue('Synthetic terms draft')
    await form.getByRole('checkbox').check()
    await form
      .getByRole('button', { name: d.sellerTerms.publish, exact: true })
      .click()
    await expect(notes).toBeEnabled()
    await expect(notes).toHaveValue('Synthetic terms draft')
    await expect(form.getByRole('checkbox')).not.toBeChecked()
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await other.click()
    await expect(page).toHaveURL('/intake/sellers')
    expect(warnings).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_terms_versions where tenant_id=$1 and seller_id=$2',
          [f.tenant, f.seller],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
