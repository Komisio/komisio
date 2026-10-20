import { openAccountingSettings } from '../helpers/accounting-settings'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('unmapped pages offer keyboard support and help search stays in the browser', async ({
  page,
}, testInfo) => {
  const email = `help-support-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/members?token=private-test-token#private-hash')
    const trigger = page.getByRole('button', {
      name: d.helpCenter.title,
      exact: true,
    })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: d.helpCenter.title, exact: true }),
    ).toBeFocused()
    const contact = dialog.getByRole('link', {
      name: d.helpCenter.support.email,
      exact: true,
    })
    const href = await contact.getAttribute('href')
    const body = new URL(href!).searchParams.get('body')!
    expect(body).toContain('/members')
    expect(body).not.toContain('private-test-token')
    expect(body).not.toContain('private-hash')
    expect(body).not.toContain(email)
    await contact.focus()
    await expect(contact).toBeFocused()
    await expect(
      dialog.getByText('support@komisio.com', { exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await dialog
      .getByRole('link', { name: d.helpCenter.support.browse, exact: true })
      .click()
    await expect(page).toHaveURL('/help')
    await expect(dialog).toHaveCount(0)
    const search = page.getByRole('searchbox', {
      name: d.helpCenter.search.label,
    })
    await expect(search).toBeVisible()
    await page.waitForLoadState('networkidle')
    const requests: string[] = []
    const capture = (request: { url(): string }) => requests.push(request.url())
    page.on('request', capture)
    await search.fill('zz-synthetic-search-no-match')
    await expect(page.getByRole('status')).toHaveText(d.helpCenter.search.empty)
    await expect(page.locator('.help-topic')).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: d.helpCenter.support.email, exact: true }),
    ).toBeVisible()
    await search.fill(d.helpCenter.articles.labels.title.toUpperCase())
    await expect(page.locator('.help-topic')).toHaveCount(1)
    expect(requests).toEqual([])
    page.off('request', capture)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('help-search-mobile.png'),
      fullPage: true,
    })
    await page.locator('.help-topic').click()
    await expect(page).toHaveURL('/help/labels')
    await expect(
      page.getByRole('link', { name: d.helpCenter.support.email, exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

test('help task links reveal the current section while cancelled navigation keeps help and edits', async ({
  page,
}) => {
  const email = `help-navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    await openAccountingSettings(page)
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

    await open.click()
    const popup = page.waitForEvent('popup')
    await dialog
      .getByRole('link', { name: d.helpCenter.fullArticle, exact: true })
      .click()
    const article = await popup
    await expect(article).toHaveURL(/\/help\/fortnox-connect$/)
    await article.close()
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('button', { name: d.helpCenter.close, exact: true })
      .click()
    await page.goto('/intake/accounting?view=accounts')
    const account = page.locator('#account-map input').first()
    await account.fill('1930')
    await open.click()
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
