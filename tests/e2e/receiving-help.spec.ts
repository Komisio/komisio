import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('label help waits for client readiness and opens on the first click', async ({
  page,
}) => {
  const email = `label-help-ready-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release!: () => void
  const scripts = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const item = await f.item('Synthetic help readiness item')
    await f.commit()
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.goto(`/intake/items/${item}/label`, { waitUntil: 'commit' })
    const open = page.getByRole('button', {
      name: d.helpCenter.title,
      exact: true,
    })
    await expect(open).toBeVisible()
    await expect(open).toBeDisabled({ timeout: 2000 })
    release()
    await expect(open).toBeEnabled()
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
      d.helpCenter.articles.labels.title,
    )
    await expect(dialog.getByRole('heading', { level: 2 })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(open).toBeFocused()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('receiving and label help preserve drafts and follow the current task without writes', async ({
  page,
  browser,
}, testInfo) => {
  const email = `receiving-help-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic help label item')
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Keep this unsaved item')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('140')
    let writes = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/api/')
      )
        writes++
    })
    const quickHelp = page.getByRole('button', {
      name: d.quickIntake.formHelp.label,
      exact: true,
    })
    await expect(quickHelp).toHaveAttribute('aria-expanded', 'false')
    await quickHelp.focus()
    await page.keyboard.press('Enter')
    await expect(quickHelp).toHaveAttribute('aria-expanded', 'true')
    const quickTips = page.locator('.form-help-content:visible')
    await expect(quickTips.locator('li')).toHaveCount(3)
    await expect(quickTips).not.toContainText(d.intake.formHelp.steps[2])
    await expect(description).toHaveValue('Keep this unsaved item')
    await quickHelp.click()
    await expect(quickTips).toHaveCount(0)
    expect(writes).toBe(0)
    const open = page.getByRole('button', {
      name: d.helpCenter.title,
      exact: true,
    })
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
      d.helpCenter.articles.receiving.title,
    )
    await expect(dialog.getByRole('heading', { level: 2 })).toBeFocused()
    await expect(dialog.locator('a[href^="/intake/accounting"]')).toHaveCount(0)
    const navigation = page.waitForEvent('dialog')
    const clicking = dialog
      .getByRole('link', { name: d.helpCenter.receiving, exact: true })
      .click()
    const warning = await navigation
    expect(warning.message()).toBe(d.quickIntake.leaveItem)
    await warning.dismiss()
    await clicking
    await expect(page).toHaveURL('/intake/quick')
    await expect(dialog).toBeVisible()
    const popup = page.waitForEvent('popup')
    await dialog.getByRole('link', { name: d.helpCenter.fullArticle }).click()
    const article = await popup
    await expect(article).toHaveURL('/help/receiving')
    await expect(article.getByRole('heading', { level: 1 })).toHaveText(
      d.helpCenter.articles.receiving.title,
    )
    await article.close()
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('receiving-help-mobile.png'),
    })
    await page.keyboard.press('Escape')
    await expect(open).toBeFocused()
    await expect(description).toHaveValue('Keep this unsaved item')
    expect(writes).toBe(0)
    // Empty the local draft deliberately before testing another task.
    await description.fill('')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('')
    await page.goto(`/intake?seller=${f.seller}#new-seller`)
    const note = page.getByLabel(d.intake.note, { exact: true })
    await note.fill('Keep this bag note')
    const receiptHelp = page.getByRole('button', {
      name: d.intake.formHelp.label,
      exact: true,
    })
    await receiptHelp.click()
    const receiptTips = page.locator('.form-help-content:visible')
    await expect(receiptTips.locator('li')).toHaveCount(3)
    await expect(receiptTips).toContainText(d.intake.formHelp.steps[2])
    await expect(receiptTips).not.toContainText(d.quickIntake.formHelp.steps[1])
    await expect(note).toHaveValue('Keep this bag note')
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320)
    await page.screenshot({ path: testInfo.outputPath('form-help-mobile.png') })
    await receiptHelp.click()
    expect(writes).toBe(0)
    await page.goto(`/intake/items/${item}/label`)
    await open.click()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
      d.helpCenter.articles.labels.title,
    )
    await expect(dialog).toContainText(d.helpCenter.articles.labels.notice)
    await expect(dialog.locator('a[href^="/intake/accounting"]')).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('label-help-mobile.png'),
    })
    await page.emulateMedia({ media: 'print' })
    await expect(dialog).toBeHidden()
    await expect(page.locator('.item-browser-label')).toBeVisible()
    await page.emulateMedia({ media: 'screen' })
    await dialog
      .getByRole('link', { name: d.helpCenter.printing, exact: true })
      .click()
    await expect(page).toHaveURL('/settings?tab=printing')
    await expect(dialog).toHaveCount(0)
    await open.click()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
      d.helpCenter.articles.labels.title,
    )
    await page.keyboard.press('Escape')
    await page.goto('/help')
    await page
      .getByRole('link', {
        name: d.helpCenter.articles.labels.title,
        exact: true,
      })
      .click()
    await expect(page).toHaveURL('/help/labels')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      d.helpCenter.articles.labels.title,
    )
    expect(writes).toBe(0)
    const anonymous = await browser.newContext()
    try {
      const guest = await anonymous.newPage()
      await guest.goto('http://127.0.0.1:3000/help/receiving')
      await expect(guest).toHaveURL(/\/login/)
    } finally {
      await anonymous.close()
    }
  } finally {
    await f.close()
  }
})
