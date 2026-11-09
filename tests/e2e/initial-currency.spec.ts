import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'

async function expectOverviewCurrency(
  page: Page,
  languageTag: string,
  currency: string,
) {
  const zero = new Intl.NumberFormat(languageTag, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(0)
  const amounts = page.locator('.dashboard-metric-amount')
  await expect(amounts).toHaveText([zero, '0', zero])
  for (const amount of await amounts.all()) await expect(amount).toBeVisible()
}

for (const [locale, currency, languageTag] of [
  ['sv', 'SEK', 'sv-SE'],
  ['no', 'NOK', 'nb-NO'],
  ['dk', 'DKK', 'da-DK'],
  ['en', 'EUR', 'en-GB'],
  ['fi', 'EUR', 'fi-FI'],
  ['de', 'EUR', 'de-DE'],
  ['es', 'EUR', 'es-ES'],
  ['it', 'EUR', 'it-IT'],
] as const) {
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
    await expectOverviewCurrency(page, languageTag, currency)
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: locale === 'sv' ? 'no' : 'sv',
        url: 'http://127.0.0.1:3000',
      },
    ])
    await page.reload()
    await expectOverviewCurrency(
      page,
      locale === 'sv' ? 'nb-NO' : 'sv-SE',
      currency,
    )
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
  await expectOverviewCurrency(page, 'sv-SE', 'USD')
  await page
    .context()
    .addCookies([
      { name: 'komisio-locale', value: 'en', url: 'http://127.0.0.1:3000' },
    ])
  await page.reload()
  await expectOverviewCurrency(page, 'en-GB', 'USD')
})
