import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { guideCopy } from '../../lib/guide-copy'
import { guideOptionHelp } from '../../lib/guide-option-help'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelNavigation(page: Page, target: Locator) {
  const prompt = page.waitForEvent('dialog')
  const click = target.click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

async function cancelReload(page: Page) {
  const prompt = page.waitForEvent('dialog')
  await page.evaluate(() => setTimeout(() => window.location.reload(), 0))
  const dialog = await prompt
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
}

test('store guide protects answers across sidebar, language and reload attempts until saved', async ({
  page,
}) => {
  const email = `guide-unsaved-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const c = guideCopy('sv')
  try {
    await f.commit()
    await page.goto('/guide')
    await page.getByLabel(c.owned, { exact: true }).check()
    await cancelNavigation(
      page,
      page.locator('.sidebar').getByRole('link', { name: d.home, exact: true }),
    )
    await expect(page).toHaveURL(/\/guide$/)
    await expect(page.getByLabel(c.owned, { exact: true })).toBeChecked()
    await cancelReload(page)
    await expect(page.getByLabel(c.owned, { exact: true })).toBeChecked()
    const picker = page.locator('.language-picker:visible').first()
    await picker.locator('summary').click()
    await cancelNavigation(
      page,
      picker.getByRole('button', { name: 'English', exact: true }),
    )
    await expect(page.getByLabel(c.owned, { exact: true })).toBeChecked()
    await picker.locator('summary').click()
    await page.getByRole('button', { name: `${c.next} →`, exact: true }).click()
    for (const label of [
      guideOptionHelp('sv').agreementLabels.no,
      c.clothes,
      c.store,
      c.other,
      c.shop,
    ]) {
      await page.getByLabel(label, { exact: true }).check()
      await page
        .getByRole('button', {
          name: `${label === c.shop ? c.summary : c.next} →`,
          exact: true,
        })
        .click()
    }
    await cancelNavigation(
      page,
      page
        .locator('.store-guide')
        .getByRole('link', { name: c.home, exact: true }),
    )
    await page.getByRole('button', { name: c.save, exact: true }).click()
    await expect(
      page.locator('.store-guide').getByRole('status'),
    ).toContainText(c.saved)
    let unexpectedDialogs = 0
    page.on('dialog', async (dialog) => {
      unexpectedDialogs++
      await dialog.dismiss()
    })
    await page
      .locator('.store-guide')
      .getByRole('link', { name: c.home, exact: true })
      .click()
    await expect(page).toHaveURL('http://127.0.0.1:3000/')
    await page.goto('/guide')
    await page.reload()
    expect(unexpectedDialogs).toBe(0)
  } finally {
    await f.close()
  }
})

test('store routines retain notes when navigation is cancelled and release the warning after save', async ({
  page,
}) => {
  const email = `routine-unsaved-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/flow')
    const note = page.getByLabel(d.storeFlow.localRoutine, { exact: true })
    await note.fill('Synthetic receiving instructions')
    const open = page.getByRole('link', {
      name: d.storeFlow.steps.receive.action,
      exact: true,
    })
    await cancelNavigation(page, open)
    await expect(note).toHaveValue('Synthetic receiving instructions')
    await cancelReload(page)
    await expect(note).toHaveValue('Synthetic receiving instructions')
    await page
      .getByRole('button', { name: d.storeFlow.save, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(d.storeFlow.saved)
    let unexpectedDialogs = 0
    page.on('dialog', async (dialog) => {
      unexpectedDialogs++
      await dialog.dismiss()
    })
    await open.click()
    await expect(page).toHaveURL(/\/intake$/)
    await page.goto('/intake/flow')
    await page.reload()
    await expect(note).toHaveValue('Synthetic receiving instructions')
    expect(unexpectedDialogs).toBe(0)
  } finally {
    await f.close()
  }
})
