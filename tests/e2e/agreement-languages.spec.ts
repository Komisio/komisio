import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import es from '../../messages/es.json' with { type: 'json' }

const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
const htmlLanguages = {
  sv: 'sv-SE',
  en: 'en-GB',
  no: 'nb-NO',
  dk: 'da-DK',
  fi: 'fi-FI',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
}

test('agreements support all product languages and preserve the saved language', async ({
  page,
}) => {
  await register(
    page,
    `agreement-languages-${randomUUID()}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  await page.getByLabel('Butikens namn').fill('Synthetic multilingual store')
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  await page
    .context()
    .addCookies([
      { name: 'komisio-locale', value: 'es', url: 'http://127.0.0.1:3000' },
    ])
  await page.goto('/intake/agreements')
  await expect(page.locator('#agreement-language')).toHaveValue('es')
  await expect(page.locator('#agreement-language option')).toHaveCount(
    locales.length,
  )
  let lastId = ''
  let firstId = ''
  for (const language of locales) {
    const a = es.agreements
    await page.locator('#agreement-title').fill(`Synthetic ${language}`)
    await page
      .locator('#agreement-body')
      .fill(`Synthetic test text ${language}`)
    await page.locator('#agreement-language').selectOption(language)
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: a.publish, exact: true }).click()
    const published = await response
    expect(published.status()).toBe(200)
    expect(published.request().postDataJSON().language).toBe(language)
    lastId = (await published.json()).id
    firstId ||= lastId
    await expect(page.getByRole('status')).toContainText(a.published)
    // Wait for the publication refresh before a separate document reload.
    // Otherwise Firefox can abort that reload when the earlier refresh lands.
    await expect(page.locator('.agreement-text')).toHaveText(
      `Synthetic test text ${language}`,
    )
    await page.goto('/intake/agreements')
    await expect(page.locator('#agreement-title')).not.toBeVisible()
    await page.getByRole('tab').last().click()
    await expect(page.locator('#agreement-language')).toHaveValue(language)
    await expect(page.locator('.agreement-text')).toHaveAttribute(
      'lang',
      htmlLanguages[language],
    )
    await expect(page.locator('.agreement-text')).toHaveText(
      `Synthetic test text ${language}`,
    )
  }
  await page
    .context()
    .addCookies([
      { name: 'komisio-locale', value: 'no', url: 'http://127.0.0.1:3000' },
    ])
  await page.goto(`/intake/agreements?version=${lastId}`)
  await page.getByRole('tab').last().click()
  await expect(page.locator('#agreement-language')).toHaveValue('it')
  await expect(page.locator('.agreement-text')).toHaveAttribute('lang', 'it-IT')
  await expect(page.locator('.agreement-text')).toHaveText(
    'Synthetic test text it',
  )
  // Print the requested historical version, not the latest publication.
  await page.goto(`/intake/agreements?version=${firstId}`)
  await expect(page.locator('.agreement-text')).toHaveText(
    'Synthetic test text sv',
  )
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.agreement-print-store')).toHaveText(
    'Synthetic multilingual store',
  )
  await expect(page.locator('.agreement-signatures')).toBeVisible()
  await expect(page.getByTestId('agreement-publisher')).not.toBeVisible()
  await expect(page.locator('.agreement-history')).not.toBeVisible()
  await expect(page.locator('.agreement-print-actions')).not.toBeVisible()
  await page.screenshot({ path: 'private/agreement-print.png', fullPage: true })
  await page.emulateMedia({ media: 'screen' })
  await expect(page.locator('.agreement-signatures')).not.toBeVisible()
})
