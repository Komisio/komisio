import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'

test('store guide saves tenant answers and restores them in another language', async ({
  page,
}) => {
  const run = randomUUID().slice(0, 8)
  await register(page, `guide-${run}@example.test`, `K!${randomUUID()}`)
  await page.getByLabel('Butikens namn').fill('Guide TEST')
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await page.getByRole('link', { name: 'Butiksguiden' }).click()
  await expect(page).toHaveURL(/\/guide$/)
  const tenant = await page.getByLabel('Aktiv butik').first().inputValue()
  await page
    .getByLabel('Säljare lämnar flera varor vid samma tillfälle')
    .check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('Kläder & accessoarer').check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('Vi i butiken', { exact: true }).check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('Säljaren hämtar tillbaka').check()
  await page.getByLabel('Vi vill kunna skänka vidare').check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('PayPal POS').check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('I den fysiska butiken').check()
  await page.getByRole('button', { name: 'Det här är er butik' }).click()
  await page.getByRole('button', { name: 'Spara butikens svar' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Svaren är sparade för Guide TEST',
  )
  await page
    .context()
    .addCookies([
      { name: 'komisio-locale', value: 'dk', url: 'http://127.0.0.1:3000' },
    ])
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Dette er jeres butik' }),
  ).toBeVisible()
  await expect(
    page
      .locator('dd')
      .filter({ hasText: 'Sælgere afleverer poser eller kasser' }),
  ).toBeVisible()
  await expect(
    page.locator('dd').filter({ hasText: 'PayPal POS' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Rediger svar' }).click()
  await expect(
    page.getByLabel('Sælgere afleverer poser eller kasser'),
  ).toBeChecked()
  // Switching the active store in another tab must reject the stale form.
  const created = await page.request.post('/api/platform', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'create',
      name: 'Guide other TEST',
      slug: `guide-other-${run}`,
      requestId: randomUUID(),
    },
  })
  expect(created.ok()).toBe(true)
  const response = await page.request.post('/api/store-guide', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      tenantId: tenant,
      requestId: randomUUID(),
      expectedCurrentId: null,
      answers: {
        intake: ['owned'],
        goods: ['clothes'],
        pricing: ['store'],
        period: [],
        pos: ['zettle'],
        channels: ['shop'],
      },
    },
  })
  expect(response.status()).toBe(409)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Hvordan får I varer ind i butikken?' }),
  ).toBeVisible()
  await expect(
    page.getByLabel('Sælgere afleverer poser eller kasser'),
  ).not.toBeChecked()
})
