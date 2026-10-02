import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
const dictionary = (locale: string): Dictionary =>
  JSON.parse(
    readFileSync(
      new URL(`../../messages/${locale}.json`, import.meta.url),
      'utf8',
    ),
  )

test('authentication tabs follow language changes without clearing typed fields', async ({
  page,
}) => {
  for (const locale of locales) {
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: locale, url: 'http://127.0.0.1:3000' },
      ])
    const d = dictionary(locale)
    for (const [path, title] of [
      ['/login', d.login],
      ['/register', d.register],
      ['/reset-password', d.reset],
    ]) {
      await page.goto(path)
      await expect(page).toHaveTitle(`${title} · Komisio`)
      await expect(page.locator('title')).toHaveCount(1)
    }
  }
  const current = dictionary('it')
  await page
    .getByLabel(current.email, { exact: true })
    .fill('synthetic-tab@example.test')
  await page.locator('.locale-switch select').selectOption('en')
  await expect(page).toHaveTitle(`${dictionary('en').reset} · Komisio`)
  await expect(
    page.getByLabel(dictionary('en').email, { exact: true }),
  ).toHaveValue('synthetic-tab@example.test')
})

test('store tab titles follow navigation, language and profile fallback without exposing private data', async ({
  page,
  browser,
}) => {
  const email = `page-titles-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/')
    const sv = dictionary('sv')
    await expect(page).toHaveTitle(`${sv.home} · Komisio`)
    await page
      .locator('.sidebar')
      .getByRole('link', { name: sv.items.title, exact: true })
      .click()
    await expect(page).toHaveTitle(`${sv.items.title} · Komisio`)
    await page.goBack()
    await expect(page).toHaveTitle(`${sv.home} · Komisio`)
    for (const locale of locales) {
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      const d = dictionary(locale)
      for (const [path, title] of [
        ['/intake/items', d.items.title],
        ['/settings', d.tenant],
        ['/help/labels', d.helpCenter.articles.labels.title],
      ]) {
        await page.goto(path)
        await expect(page).toHaveTitle(`${title} · Komisio`)
        await expect(page.locator('title')).toHaveCount(1)
      }
    }
    const updated = await page.request.post('/api/platform', {
      headers: { origin: 'http://127.0.0.1:3000' },
      data: { action: 'profile', name: 'Synthetic title user', locale: 'en' },
    })
    expect(updated.status()).toBe(200)
    await page.context().clearCookies({ name: 'komisio-locale' })
    await page.goto('/settings')
    await expect(page).toHaveTitle(`${dictionary('en').tenant} · Komisio`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      dictionary('en').tenant,
    )
    for (const [path, title] of [
      ['/seller', dictionary('en').sellerPortal.title],
      [`/review/${'a'.repeat(64)}`, dictionary('en').reviewTitle],
    ]) {
      await page.goto(path)
      await expect(page).toHaveTitle(`${title} · Komisio`)
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex.*nofollow/,
      )
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
        'content',
        'no-referrer',
      )
    }
    const anonymous = await browser.newContext()
    try {
      const other = await anonymous.newPage()
      await other.goto('http://127.0.0.1:3000/login')
      await expect(other).toHaveTitle(`${sv.login} · Komisio`)
    } finally {
      await anonymous.close()
    }
  } finally {
    await f.close()
  }
})
