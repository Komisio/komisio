import legacyHelp from '../fixtures/help-legacy.json' with { type: 'json' }
import { openAccountingSettings } from '../helpers/accounting-settings'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import fi from '../../messages/fi.json' with { type: 'json' }
import { helpArticle } from '../../lib/help/content'

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
    await page.goto(
      '/settings?tab=profile&token=private-test-token#private-hash',
    )
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
    expect(body).toContain('/settings?tab=profile')
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
    await search.fill(legacyHelp.sv.articles.labels.title.toUpperCase())
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
      name: legacyHelp.sv.articles['fortnox-automation'].title,
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

test('new help is keyboard accessible, falls back to English and shares submitted feedback across modal and article', async ({
  page,
  baseURL,
}, info) => {
  const email = `help-feedback-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page
      .context()
      .addCookies([{ name: 'komisio-locale', value: 'fi', url: baseURL! }])
    await page.goto('/members?token=private-test-token')
    const trigger = page.getByRole('button', {
      name: fi.helpCenter.title,
      exact: true,
    })
    await trigger.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', {
        name: helpArticle('en', 'members-roles')!.title,
        exact: true,
      }),
    ).toBeFocused()
    await expect(dialog.getByText(fi.helpCenter.fallbackNote)).toBeVisible()
    const yes = dialog.getByRole('radio', {
      name: fi.helpCenter.feedback.yes,
      exact: true,
    })
    await yes.focus()
    await page.keyboard.press('Space')
    const comment = dialog.getByLabel(fi.helpCenter.feedback.comment, {
      exact: true,
    })
    await comment.fill('Synthetic helpful guidance')
    await expect(comment).toHaveAttribute('maxlength', '1000')
    await expect(dialog.getByText(fi.helpCenter.feedback.privacy)).toBeVisible()
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/help/feedback') &&
        r.request().method() === 'POST',
    )
    await dialog
      .getByRole('button', { name: fi.helpCenter.feedback.send, exact: true })
      .press('Enter')
    expect((await response).status()).toBe(200)
    await expect(dialog.getByRole('status')).toHaveText(
      fi.helpCenter.feedback.thanks,
    )
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    const rows = (
      await f.db.query('select * from help_feedback where tenant_id=$1', [
        f.tenant,
      ])
    ).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      slug: 'members-roles',
      locale: 'fi',
      page: '/members',
      helpful: true,
      comment: 'Synthetic helpful guidance',
    })
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'id',
        'tenant_id',
        'slug',
        'locale',
        'page',
        'helpful',
        'comment',
        'created_at',
      ].sort(),
    )
    await page.keyboard.press('Escape')
    await page.goto('/help/members-roles')
    await expect(page.getByRole('status')).toHaveText(
      fi.helpCenter.feedback.thanks,
    )
    await expect(page.getByRole('radio')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('status')).toHaveText(
      fi.helpCenter.feedback.thanks,
    )
    await page.screenshot({
      path: info.outputPath('help-fallback-feedback.png'),
      fullPage: true,
    })
    // Another article remains answerable; empty optional comments become NULL.
    await page.goto('/help/sign-in-mfa')
    await page
      .getByRole('radio', { name: fi.helpCenter.feedback.no, exact: true })
      .check()
    await page
      .getByRole('button', { name: fi.helpCenter.feedback.send, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      fi.helpCenter.feedback.thanks,
    )
    expect(
      (
        await f.db.query(
          "select page,comment,helpful from help_feedback where tenant_id=$1 and slug='sign-in-mfa'",
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ page: '/help/[topic]', comment: null, helpful: false }])
  } finally {
    await f.close()
  }
})
