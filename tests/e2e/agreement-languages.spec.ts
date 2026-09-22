import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import es from '../../messages/es.json' with { type: 'json' }

const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']

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
  for (const language of locales) {
    const a = es.agreements
    await page.locator('#agreement-title').fill(`Synthetic ${language}`)
    await page
      .locator('#agreement-body')
      .fill(`Synthetic test text ${language}`)
    await page.locator('#agreement-language').selectOption(language)
    await page.getByLabel(a.confirmPublish, { exact: true }).check()
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: a.publish, exact: true }).click()
    const published = await response
    expect(published.status()).toBe(200)
    expect(published.request().postDataJSON().language).toBe(language)
    lastId = (await published.json()).id
    await expect(page.getByRole('status')).toContainText(a.published)
    await page.reload()
    await expect(page.locator('#agreement-language')).toHaveValue(language)
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
  await expect(page.locator('#agreement-language')).toHaveValue('it')
  await expect(page.locator('.agreement-text')).toHaveText(
    'Synthetic test text it',
  )
})
