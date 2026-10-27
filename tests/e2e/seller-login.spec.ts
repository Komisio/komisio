import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register, confirmEmail } from '../helpers/account'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller login opens the only store, recovery requires a new password, and dual-role switching preserves roles', async ({
  page,
}, info) => {
  const email = `seller-login-${randomUUID()}@example.test`,
    password = `K!${randomUUID()}`,
    replacement = `K!${randomUUID()}`
  await register(page, email, password, '/seller')
  await expect(page).toHaveURL(/\/seller$/)
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await db.connect()
  try {
    const user = (
      await db.query('select id from auth.users where email=$1', [email])
    ).rows[0].id
    const owner = randomUUID()
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `${owner}@example.test`],
    )
    const store = async (name: string) => {
      await db.query('begin')
      await db.query('set local role authenticated')
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: owner, role: 'authenticated' }),
      ])
      const tenant = (
        await db.query('select create_tenant($1,$2,$3) id', [
          name,
          `seller-login-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      const seller = (
        await db.query(
          "select register_seller($1,$2,'Synthetic seller',$3,'') id",
          [tenant, randomUUID(), email],
        )
      ).rows[0].id
      await db.query('commit')
      return { tenant, seller }
    }
    const first = await store('Synthetic first store')
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/seller\\?seller=${first.seller}`))
    await expect(
      page.getByRole('navigation', { name: d.sellerAccess.switchView }),
    ).toHaveCount(0)
    await page.locator('.seller-account-menu summary').click()
    await page.getByRole('button', { name: d.logout, exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.goto('/login?next=/account')
    await page.getByLabel(d.email, { exact: true }).fill(email)
    await page.getByLabel(d.password, { exact: true }).fill(password)
    await page.getByRole('button', { name: d.login, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/seller\\?seller=${first.seller}`))
    await page.locator('.seller-account-menu summary').click()
    await page.getByRole('button', { name: d.logout, exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.goto('/login?next=/seller')
    await page.getByRole('link', { name: d.forgot, exact: true }).click()
    await expect(
      page.getByRole('heading', { name: d.reset, exact: true }),
    ).toBeVisible()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('next'))
      .toBe('/seller')
    await page.getByLabel(d.email, { exact: true }).fill(email)
    await page.getByRole('button', { name: d.sendReset, exact: true }).click()
    await expect(page.getByText(d.resetSent, { exact: true })).toBeVisible()
    await confirmEmail(page, email, d.authEmail.recovery.subject)
    await expect(
      page.getByRole('heading', {
        name: d.sellerAccess.choosePassword,
        exact: true,
      }),
    ).toBeVisible()
    await page.goto('/seller')
    await expect(page).toHaveURL(/\/update-password/)
    await page.getByLabel(d.newPassword, { exact: true }).fill(replacement)
    await page
      .getByRole('button', { name: d.savePassword, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`/seller\\?seller=${first.seller}`))
    await page.locator('.seller-account-menu summary').click()
    await page.getByRole('button', { name: d.logout, exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel(d.email, { exact: true }).fill(email)
    await page.getByLabel(d.password, { exact: true }).fill(password)
    await page.getByRole('button', { name: d.login, exact: true }).click()
    await expect(page.getByText(d.authError, { exact: true })).toBeVisible()
    await page.getByLabel(d.password, { exact: true }).fill(replacement)
    await page.getByRole('button', { name: d.login, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/seller\\?seller=${first.seller}`))
    await store('Synthetic second store')
    await page.goto('/seller')
    await expect(
      page.getByRole('link', { name: /^Synthetic first store\b/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /^Synthetic second store\b/ }),
    ).toBeVisible()
    // Fixture grants staff explicitly; navigation itself must never grant a role.
    await db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'staff')",
      [first.tenant, user],
    )
    await page.reload()
    const switcher = page.getByRole('navigation', {
      name: d.sellerAccess.switchView,
    })
    await expect(switcher).toBeVisible()
    await switcher
      .getByRole('link', { name: d.sellerAccess.store, exact: true })
      .click()
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(
      switcher.getByRole('link', { name: d.sellerAccess.store, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await page.setViewportSize({ width: 320, height: 800 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)
    await page.screenshot({
      path: info.outputPath('role-switch-320.png'),
      fullPage: true,
    })
    await switcher
      .getByRole('link', { name: d.sellerAccess.seller, exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: /^Synthetic first store\b/ }),
    ).toBeVisible()
    expect(
      (
        await db.query(
          'select role from tenant_members where tenant_id=$1 and user_id=$2',
          [first.tenant, user],
        )
      ).rows,
    ).toEqual([{ role: 'staff' }])
  } finally {
    await db.query('rollback')
    await db.end()
  }
})

test('an unconfirmed login explains verification and resends without entering the portal', async ({
  page,
}) => {
  const email = `unconfirmed-${randomUUID()}@example.test`,
    password = `K!${randomUUID()}`
  await page.goto('/register?next=/seller')
  await page.getByLabel(d.email, { exact: true }).fill(email)
  await page.getByLabel(d.password, { exact: true }).fill(password)
  await page.getByRole('button', { name: d.register, exact: true }).click()
  await expect(page.getByText(d.verifySent, { exact: true })).toBeVisible()
  const sent = Date.now()
  await page.goto('/login?next=/seller')
  await page.getByLabel(d.email, { exact: true }).fill(email)
  await page.getByLabel(d.password, { exact: true }).fill(password)
  await page.getByRole('button', { name: d.login, exact: true }).click()
  await expect(
    page.getByRole('heading', {
      name: d.sellerAccess.confirmEmail,
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByLabel(d.email, { exact: true })).toHaveValue(email)
  // The local Auth fixture deliberately keeps a one-second email cooldown.
  await expect.poll(() => Date.now() - sent).toBeGreaterThan(1500)
  const response = page.waitForResponse((r) =>
    r.url().includes('/auth/v1/resend'),
  )
  await page.getByRole('button', { name: d.resend, exact: true }).click()
  expect((await response).ok()).toBe(true)
  await expect(page.getByText(d.verifySent, { exact: true })).toBeVisible()
  await confirmEmail(page, email)
  await expect(page).toHaveURL(/\/seller$/)
})
