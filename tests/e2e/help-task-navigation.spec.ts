import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('help task links reveal the current section while cancelled navigation keeps help and edits', async ({
  page,
}) => {
  const email = `help-navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const account = page.locator('#account-map input').first()
    await account.fill('1930')
    const open = page.getByRole('button', {
      name: d.helpCenter.title,
      exact: true,
    })
    const dialog = page.getByRole('dialog')
    await open.click()
    await dialog
      .getByRole('link', { name: d.helpCenter.settings, exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(account).toHaveValue('1930')
    await expect(open).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      'hidden',
    )

    const automation = page.getByRole('button', {
      name: d.helpCenter.articles['fortnox-automation'].title,
      exact: true,
    })
    await automation.click()
    await dialog
      .getByRole('link', { name: d.helpCenter.settings, exact: true })
      .click()
    await expect(page).toHaveURL(/#fortnox-automation$/)
    await expect(dialog).toHaveCount(0)
    await expect(account).toHaveValue('1930')

    await open.click()
    const popup = page.waitForEvent('popup')
    await dialog
      .getByRole('link', { name: d.helpCenter.fullArticle, exact: true })
      .click()
    const article = await popup
    await expect(article).toHaveURL(/\/help\/fortnox-connect$/)
    await article.close()
    await expect(dialog).toBeVisible()
    await expect(account).toHaveValue('1930')
    page.once('dialog', async (prompt) => {
      expect(prompt.type()).toBe('confirm')
      await prompt.dismiss()
    })
    await dialog
      .getByRole('link', { name: d.helpCenter.days, exact: true })
      .click()
    await expect(dialog).toBeVisible()
    await expect(account).toHaveValue('1930')
    page.once('dialog', async (prompt) => {
      expect(prompt.type()).toBe('confirm')
      await prompt.accept()
    })
    await dialog
      .getByRole('link', { name: d.helpCenter.days, exact: true })
      .click()
    await expect(page).toHaveURL('/intake/accounting')
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      'hidden',
    )
  } finally {
    await f.close()
  }
})
