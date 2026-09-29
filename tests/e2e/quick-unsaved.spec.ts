import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function confirmSellerChange(page: Page, accept: boolean) {
  const dialog = page.waitForEvent('dialog')
  const click = page
    .getByRole('button', { name: d.quickIntake.changeSeller, exact: true })
    .click()
  const prompt = await dialog
  expect(prompt.type()).toBe('confirm')
  expect(prompt.message()).toBe(d.quickIntake.discardForSellerChange)
  if (accept) await prompt.accept()
  else await prompt.dismiss()
  await click
}

test('quick reception protects entered data and clears the warning after acceptance', async ({
  page,
}) => {
  const email = `unsaved-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    await description.fill('Synthetic protected coat')
    await price.fill('120')
    await confirmSellerChange(page, false)
    await expect(description).toHaveValue('Synthetic protected coat')
    await expect(price).toHaveValue('120')

    const beforeUnload = page.waitForEvent('dialog')
    await page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0)
    })
    const warning = await beforeUnload
    expect(warning.type()).toBe('beforeunload')
    await warning.dismiss()
    await expect(description).toHaveValue('Synthetic protected coat')
    await expect(price).toHaveValue('120')

    await confirmSellerChange(page, true)
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(description).toHaveValue('')
    await expect(price).toHaveValue('')

    // Real browser action: a discarded, empty attempt must not prompt.
    let unexpectedDialogs = 0
    page.on('dialog', async (dialog) => {
      unexpectedDialogs++
      await dialog.accept()
    })
    await page.reload()
    expect(unexpectedDialogs).toBe(0)
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await description.fill('Synthetic accepted coat')
    await price.fill('130')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toBeVisible()
    await page.reload()
    expect(unexpectedDialogs).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
