import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register, confirmEmail } from '../helpers/account'
const languages = {
  sv: 'sv-SE',
  en: 'en-GB',
  no: 'nb-NO',
  dk: 'da-DK',
  fi: 'fi-FI',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
}

test('entry languages stay fallbacks across authentication screens and explicit choices win', async ({
  page,
  context,
}) => {
  for (const [lang, tag] of Object.entries(languages)) {
    await context.clearCookies()
    await page.goto(`/login?lang=${lang}&next=%2Fseller`)
    await expect(page.locator('.auth-layout')).toHaveAttribute('lang', tag)
    expect(
      (await context.cookies()).some((c) => c.name === 'komisio-locale'),
    ).toBe(false)
  }
  await context.clearCookies()
  await page.goto('/login?lang=invalid&next=%2Fseller')
  await expect(page.locator('.auth-layout')).toHaveAttribute('lang', 'sv-SE')
  await page.goto('/login?lang=dk&next=%2Fseller')
  await page.locator('a[href^="/reset-password"]').click()
  await expect(page.locator('.auth-layout')).toHaveAttribute('lang', 'da-DK')
  await page.goto('/login?next=%2Fseller')
  await page.locator('a[href^="/register"]').click()
  await expect(page.locator('.auth-layout')).toHaveAttribute('lang', 'da-DK')
  await page.locator('select').selectOption('en')
  await page.goto('/login?lang=dk&next=%2Fseller')
  await expect(page.locator('.auth-layout')).toHaveAttribute('lang', 'en-GB')
})

test('saved profile wins after password login without a browser preference', async ({
  page,
  context,
}) => {
  const email = `entry-profile-${randomUUID()}@example.test`
  const password = `K!${randomBytes(16).toString('hex')}`
  await register(page, email, password, '/seller')
  await expect(page).toHaveURL(/\/seller$/)
  await page.goto('/account')
  await page.locator('#profile-name').fill('Synthetic language test')
  await page.locator('#profile-language').selectOption('sv')
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/platform') && r.request().method() === 'POST',
  )
  await page
    .locator('form')
    .filter({ has: page.locator('#profile-language') })
    .getByRole('button', { name: 'Spara ändringar', exact: true })
    .click()
  expect((await saved).ok()).toBe(true)

  await context.clearCookies()
  await page.goto('/login?lang=dk&next=%2Fseller')
  await expect(page.locator('.auth-layout')).toHaveAttribute('lang', 'da-DK')
  await page.locator('[name="email"]').fill(email)
  await page.locator('[name="password"]').fill(password)
  await page.locator('form button.full').click()
  await expect(page).toHaveURL(/\/seller$/)
  await expect(page.locator('main')).toHaveAttribute('lang', 'sv-SE')
  await page.goto('/login?lang=it&next=%2Fseller')
  await expect(page.locator('.auth-layout')).toHaveAttribute('lang', 'sv-SE')
  expect(
    (await context.cookies()).some((c) => c.name === 'komisio-locale'),
  ).toBe(false)
})

test('new seller registration retains entry language through email verification', async ({
  page,
  context,
}) => {
  const email = `entry-new-${randomUUID()}@example.test`
  await page.goto('/login?lang=dk&next=%2Fseller')
  await page.locator('a[href^="/register"]').click()
  await expect(page).toHaveURL(/\/register\?/)
  await expect(page.locator('form button.full')).toBeEnabled()
  await page.locator('[name="email"]').fill(email)
  await page
    .locator('[name="password"]')
    .fill(`K!${randomBytes(16).toString('hex')}`)
  const signup = page.waitForResponse(
    (r) =>
      r.url().includes('/auth/v1/signup') && r.request().method() === 'POST',
  )
  await page.locator('form button.full').click()
  expect((await signup).ok()).toBe(true)
  await confirmEmail(page, email)
  await expect(page).toHaveURL(/\/seller$/)
  await expect(page.locator('main')).toHaveAttribute('lang', 'da-DK')
  expect(
    (await context.cookies()).some((c) => c.name === 'komisio-locale'),
  ).toBe(false)
})
