import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'

test('store guide saves tenant answers and restores them in another language', async ({
  page,
}) => {
  const run = randomUUID().slice(0, 8)
  await register(page, `guide-${run}@example.test`, `K!${randomUUID()}`)
  await page.getByLabel('Butikens namn', { exact: true }).fill('Guide TEST')
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await page.getByRole('link', { name: 'Butiksguiden' }).click()
  await expect(page).toHaveURL(/\/guide$/)
  const tenant = await page
    .getByLabel('Aktiv butik', { exact: true })
    .first()
    .inputValue()
  const info = page.getByRole('button', {
    name: 'Information om Säljare lämnar enskilda varor',
    exact: true,
  })
  const option = page.getByRole('checkbox', {
    name: 'Säljare lämnar enskilda varor',
    exact: true,
  })
  await expect(page.locator('.guide-info-button')).toHaveCount(7)
  await info.hover()
  await expect(page.getByRole('tooltip')).toContainText('en jacka')
  await page.getByRole('heading', { level: 1 }).hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await info.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(option).not.toBeChecked()
  await page.setViewportSize({ width: 390, height: 844 })
  await info.click()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(option).not.toBeChecked()
  await page.screenshot({ path: 'private/guide-help-mobile.png' })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await info.click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await info.click()
  await page.screenshot({ path: 'private/guide-help-desktop.png' })
  await page.getByRole('heading', { level: 1 }).click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  await page
    .getByLabel('Säljare lämnar flera varor vid samma tillfälle', {
      exact: true,
    })
    .check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByRole('radio', { name: 'Ja', exact: true }).check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('Kläder & accessoarer', { exact: true }).check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('Vi i butiken', { exact: true }).check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('Säljaren hämtar tillbaka', { exact: true }).check()
  await page.getByLabel('Vi vill kunna skänka vidare', { exact: true }).check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('PayPal POS', { exact: true }).check()
  await page.getByRole('button', { name: 'Nästa' }).click()
  await page.getByLabel('I den fysiska butiken', { exact: true }).check()
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
      .filter({ hasText: 'Sælgere afleverer flere varer samtidig' }),
  ).toBeVisible()
  await expect(
    page.locator('dd').filter({ hasText: 'PayPal POS' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Rediger svar' }).click()
  await expect(
    page.getByLabel('Sælgere afleverer flere varer samtidig', { exact: true }),
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
    page.getByLabel('Sælgere afleverer flere varer samtidig', { exact: true }),
  ).not.toBeChecked()
})
