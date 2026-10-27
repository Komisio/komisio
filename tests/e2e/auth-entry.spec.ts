import { test, expect } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import d from '../../messages/sv.json' with { type: 'json' }

const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
const dictionary = (locale: string): Dictionary =>
  JSON.parse(
    readFileSync(
      new URL(`../../messages/${locale}.json`, import.meta.url),
      'utf8',
    ),
  )

test('default and seller auth explain the right account in every language', async ({
  page,
  context,
}, info) => {
  for (const locale of locales) {
    await context.addCookies([
      { name: 'komisio-locale', value: locale, url: 'http://127.0.0.1:3000' },
    ])
    const t = dictionary(locale)
    for (const seller of [false, true]) {
      const destination = seller ? '/seller' : '/'
      await page.goto('/login?next=' + encodeURIComponent(destination))
      await expect(page.locator('.auth-form')).toContainText(
        seller ? t.sellerAuth.loginIntro : t.loginIntro,
      )
      await expect(page.locator('.auth-footer')).toContainText(
        seller ? t.sellerAuth.noAccount : t.storeAccountPrompt,
      )
      await expect(page.locator('.auth-seller-hint')).toHaveCount(
        seller ? 0 : 1,
      )
      if (!seller)
        await expect(page.locator('.auth-seller-hint')).toHaveText(
          t.sellerLinkHint,
        )
      await expect(page.locator('.auth-story')).toContainText(
        seller ? t.sellerAuth.headline : t.tagline,
      )
      if (seller)
        await expect(page.locator('.auth-layout')).not.toContainText(t.help)
      const signup = page.getByRole('link', { name: t.register, exact: true })
      await expect(signup).toHaveAttribute(
        'href',
        '/register?next=' + encodeURIComponent(destination),
      )
      if (locale === 'sv') {
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 950 })
          if (width === 1280)
            await expect(page.locator('.auth-story')).toBeVisible()
          else await expect(page.locator('.auth-story')).toBeHidden()
          await page.evaluate(() => document.fonts.ready)
          await page.screenshot({
            path: info.outputPath(
              `${seller ? 'seller' : 'default'}-login-${width}.png`,
            ),
            fullPage: true,
          })
        }
      }
      await signup.click()
      await expect(page.locator('.auth-form')).toContainText(
        seller ? t.sellerAuth.registerIntro : t.registerIntro,
      )
      await expect(
        page.getByRole('link', { name: t.login, exact: true }),
      ).toHaveAttribute(
        'href',
        '/login?next=' + encodeURIComponent(destination),
      )
      if (seller)
        await expect(page.locator('.auth-layout')).not.toContainText(
          t.registerIntro,
        )
      if (locale === 'sv') {
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 950 })
          if (width === 1280)
            await expect(page.locator('.auth-story')).toBeVisible()
          else await expect(page.locator('.auth-story')).toBeHidden()
          await page.evaluate(() => document.fonts.ready)
          await page.screenshot({
            path: info.outputPath(
              `${seller ? 'seller' : 'default'}-register-${width}.png`,
            ),
            fullPage: true,
          })
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
  }
})

test('unsafe destinations stay neutral and staff invitations retain their copy', async ({
  page,
}) => {
  for (const destination of [
    '//evil.test/seller',
    '/seller/../login',
    '/seller?next=https://evil.test',
    'https://evil.test/seller',
  ]) {
    await page.goto('/login?next=' + encodeURIComponent(destination))
    await expect(page.locator('.auth-form')).toContainText(d.loginIntro)
    await expect(
      page.getByRole('link', { name: d.register, exact: true }),
    ).toHaveAttribute('href', '/register?next=%2F')
  }
  const invite = '/invite/' + 'a'.repeat(64)
  await page.goto('/login?next=' + encodeURIComponent(invite))
  await expect(
    page.getByText(d.invitedLoginIntro, { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.auth-footer')).toContainText(d.noAccount)
  await page.getByRole('link', { name: d.register, exact: true }).click()
  await expect(
    page.getByText(d.invitedRegisterIntro, { exact: true }),
  ).toBeVisible()
})

test('default signup and login return a store owner to the store', async ({
  page,
}) => {
  const email = `auth-owner-${randomUUID()}@example.test`
  const password = `K!${randomUUID()}`
  await register(page, email, password)
  await page
    .getByLabel('Butikens namn', { exact: true })
    .fill('Synthetic auth store')
  await page
    .getByRole('button', { name: 'Skapa min butik', exact: true })
    .click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.goto('/account')
  await page.getByRole('button', { name: d.logout, exact: true }).click()
  await page.goto('/login')
  await page.getByLabel(d.email, { exact: true }).fill(email)
  await page.getByLabel(d.password, { exact: true }).fill(password)
  await page.getByRole('button', { name: d.login, exact: true }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
})

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = secret
    .replace(/=+$/, '')
    .toUpperCase()
    .split('')
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[19] & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0')
}

test('seller signup, email verification and MFA login retain the portal destination', async ({
  page,
}) => {
  const email = `auth-seller-${randomUUID()}@example.test`
  const password = `K!${randomUUID()}`
  await register(page, email, password, '/seller')
  await expect(page).toHaveURL(/\/seller$/)
  await page.goto('/account')
  const enrolled = page.waitForResponse(
    (r) =>
      r.url().includes('/auth/v1/factors') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: d.mfaEnable, exact: true }).click()
  const factor = await (await enrolled).json()
  await page
    .getByLabel(d.mfaCode, { exact: true })
    .fill(totp(factor.totp.secret))
  await page.getByRole('button', { name: d.mfaVerify, exact: true }).click()
  await expect(page.getByText(d.mfaEnabled, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: d.logout, exact: true }).click()
  await page.goto('/login?next=%2Fseller')
  await expect(
    page.getByText(d.sellerAuth.loginIntro, { exact: true }),
  ).toBeVisible()
  await page.getByLabel(d.email, { exact: true }).fill(email)
  await page.getByLabel(d.password, { exact: true }).fill(password)
  await page.getByRole('button', { name: d.login, exact: true }).click()
  await expect(page).toHaveURL(/\/mfa\?next=%2Fseller$/)
  await page
    .getByLabel(d.mfaCode, { exact: true })
    .fill(totp(factor.totp.secret))
  await page.getByRole('button', { name: d.mfaVerify, exact: true }).click()
  await expect(page).toHaveURL(/\/seller$/)
})
