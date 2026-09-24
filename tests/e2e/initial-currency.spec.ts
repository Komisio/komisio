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

test('explicit USD overrides the language suggestion and remains after language changes', async ({
  page,
}) => {
  const d = JSON.parse(readFileSync('messages/sv.json', 'utf8'))
  await register(
    page,
    'usd-' + randomUUID() + '@example.test',
    'K!' + randomUUID(),
  )
  await page.getByLabel(d.tenantName, { exact: true }).fill('TEST USD store')
  await page
    .getByLabel(d.storePolicy.currency, { exact: true })
    .selectOption('USD')
  await page.getByRole('button', { name: d.createButton, exact: true }).click()
  await expect(page.getByLabel(d.activeTenant).first()).toBeVisible()
  await page.goto('/')
  await expect(
    page.getByText('0.00 USD', { exact: true }).first(),
  ).toBeVisible()
  await page
    .context()
    .addCookies([
      { name: 'komisio-locale', value: 'en', url: 'http://127.0.0.1:3000' },
    ])
  await page.reload()
  await expect(
    page.getByText('0.00 USD', { exact: true }).first(),
  ).toBeVisible()
})
