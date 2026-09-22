import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'

for (const [locale, currency] of Object.entries({
  sv: 'SEK',
  no: 'NOK',
  dk: 'DKK',
  en: 'EUR',
  fi: 'EUR',
  de: 'EUR',
  es: 'EUR',
  it: 'EUR',
})) {
  test(`new ${locale} store retains ${currency} after a language change`, async ({
    page,
  }) => {
    const d = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'))
    await register(
      page,
      `currency-${randomUUID()}@example.test`,
      `K!${randomUUID()}`,
    )
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: locale, url: 'http://127.0.0.1:3000' },
      ])
    await page.reload()
    await page
      .getByLabel(d.tenantName, { exact: true })
      .fill('TEST Initial currency')
    await page
      .getByRole('button', { name: d.createButton, exact: true })
      .click()
    await expect(page.getByLabel(d.activeTenant).first()).toBeVisible()
    await page.goto('/')
    await expect(
      page.getByText(`0.00 ${currency}`, { exact: true }).first(),
    ).toBeVisible()
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: locale === 'sv' ? 'no' : 'sv',
        url: 'http://127.0.0.1:3000',
      },
    ])
    await page.reload()
    await expect(
      page.getByText(`0.00 ${currency}`, { exact: true }).first(),
    ).toBeVisible()
  })
}
