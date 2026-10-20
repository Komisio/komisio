import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'

const localeKeys = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
const messages = (locale: string) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'))
const documentBase = 'https://documents.example.test/legal'

test('registration legal links follow every language, fit mobile and preserve form entries when opened', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.context().route(`${documentBase}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<p>Synthetic document</p>',
    }),
  )
  await page.goto('/register')
  await page.locator('#email').fill('synthetic-draft@example.test')
  for (const locale of localeKeys) {
    const d = messages(locale)
    await page.locator('.locale-switch select').selectOption(locale)
    const links = page.getByRole('navigation', {
      name: d.legal.title,
      exact: true,
    })
    for (const name of ['terms', 'privacy', 'dpa']) {
      await expect(
        links.getByRole('link', {
          name: `${d.legal[name]} (${d.legal.newTab})`,
          exact: true,
        }),
      ).toHaveAttribute('href', `${documentBase}/${locale}/${name}/`)
    }
    await expect(page.locator('#email')).toHaveValue(
      'synthetic-draft@example.test',
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  }
  const link = page.locator('.legal-links a').first()
  await link.focus()
  const popup = page.waitForEvent('popup')
  await page.keyboard.press('Enter')
  const documentPage = await popup
  await expect(documentPage).toHaveURL(`${documentBase}/it/terms/`)
  await documentPage.close()
  await expect(page.locator('#email')).toHaveValue(
    'synthetic-draft@example.test',
  )
  await page.screenshot({
    path: testInfo.outputPath('legal-register-mobile.png'),
    fullPage: true,
  })
})

test('store creation and the permanent settings entry show the configured documents', async ({
  page,
  baseURL,
}) => {
  await register(
    page,
    `legal-${randomUUID()}@example.test`,
    `K!${randomUUID()}`,
  )
  await expect(page.locator('.legal-links a')).toHaveCount(3)
  await expect(page.locator('.legal-links a').first()).toHaveAttribute(
    'href',
    `${documentBase}/sv/terms/`,
  )
  await page
    .getByLabel('Butikens namn', { exact: true })
    .fill('Synthetic legal link store')
  await page
    .getByRole('button', { name: messages('sv').createButton, exact: true })
    .click()
  await expect(page).not.toHaveURL(/\/onboarding$/)
  await page
    .context()
    .addCookies([{ name: 'komisio-locale', value: 'dk', url: baseURL! }])
  await page.goto('/settings?tab=store')
  await page.locator('.page-heading a[href="#settings-legal"]').click()
  await expect(page).toHaveURL(/#settings-legal$/)
  await expect(page.locator('#settings-legal')).toBeInViewport()
  await expect(page.locator('#settings-legal a')).toHaveCount(3)
  await expect(page.locator('#settings-legal a').first()).toHaveAttribute(
    'href',
    `${documentBase}/dk/terms/`,
  )
})
