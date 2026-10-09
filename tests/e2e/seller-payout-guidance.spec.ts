import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }

test('payout and preference retries keep separate payloads after unconfirmed replies', async ({
  page,
}) => {
  const email = `seller-economy-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic economy seller',
        email,
        '',
      ])
    ).rows[0].id
    await f.db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      seller,
      50000,
      'Synthetic recovery fixture',
    ])
    await f.commit()
    await page.goto(`/seller?seller=${seller}`)
    const request = page.getByRole('region', {
      name: sv.sellerPortal.request,
      exact: true,
    })
    const input = request.getByLabel(
      sv.sellerPortal.amount.replace('{currency}', 'SEK'),
      { exact: true },
    )
    const checkbox = page.getByRole('checkbox', {
      name: sv.sellerPortal.emails,
    })
    const preferences = page.locator('form').filter({ has: checkbox })
    const payloads = new Map<string, unknown[]>()
    await page.route('**/api/seller/economy', async (route) => {
      const payload = route.request().postDataJSON()
      const history = payloads.get(payload.action) ?? []
      history.push(payload)
      payloads.set(payload.action, history)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (history.length === 1) {
        await route.fulfill(
          payload.action === 'notifications'
            ? { status: 200, json: { ok: true, id: randomUUID() } }
            : { status: 503, json: { error: 'INVALID_INPUT' } },
        )
      } else await route.fulfill({ response })
    })
    await checkbox.uncheck()
    await preferences
      .getByRole('button', { name: sv.sellerPortal.save, exact: true })
      .click()
    await expect(preferences.getByRole('alert')).toHaveText(
      sv.sellerPortal.preferenceError,
    )
    await expect(checkbox).toBeDisabled()
    await expect(checkbox).not.toBeChecked()
    await input.fill('100,00')
    await request
      .getByRole('button', { name: sv.sellerPortal.request, exact: true })
      .click()
    await expect(request.getByRole('alert')).toHaveText(sv.sellerPortal.error)
    await expect(input).toBeDisabled()
    await expect(input).toHaveValue('100,00')
    await preferences
      .getByRole('button', { name: sv.intake.retry, exact: true })
      .click()
    await expect(preferences.getByRole('status')).toHaveText(
      sv.sellerPortal.saved,
    )
    await expect(checkbox).toHaveJSProperty('defaultChecked', false)
    await expect(checkbox).not.toBeChecked()
    await expect(input).toBeDisabled()
    await expect(input).toHaveValue('100,00')
    await request
      .getByRole('button', { name: sv.intake.retry, exact: true })
      .click()
    await expect(request.getByRole('status')).toHaveText(
      sv.sellerPortal.payoutRequested,
    )
    await expect(input).toBeEnabled()
    await expect(input).toHaveValue('')
    for (const history of payloads.values()) {
      expect(history).toHaveLength(2)
      expect(history[0]).toEqual(history[1])
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from payouts where tenant_id=$1 and seller_id=$2',
          [f.tenant, seller],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_notification_preferences where tenant_id=$1 and seller_id=$2',
          [f.tenant, seller],
        )
      ).rows[0].n,
    ).toBe(1)
    await input.fill('120')
    await expect(request.getByRole('status')).toHaveCount(0)
    await page.unroute('**/api/seller/economy')
    await page.route('**/api/seller/economy', (route) =>
      route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } }),
    )
    await request
      .getByRole('button', { name: sv.sellerPortal.request, exact: true })
      .click()
    await expect(request.getByRole('alert')).toHaveText(sv.intake.denied)
    await expect(input).toBeDisabled()
    await expect(
      request.getByRole('button', { name: sv.intake.reload, exact: true }),
    ).toBeVisible()
    await expect(
      request.getByRole('button', { name: sv.intake.retry, exact: true }),
    ).toBeDisabled()
  } finally {
    await f.close()
  }
})

test('seller payout guidance explains unavailable balances, validates amounts and refreshes a stale balance', async ({
  page,
}, testInfo) => {
  const email = `seller-guidance-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  const owner = randomUUID()
  async function asOwner<T>(work: () => Promise<T>): Promise<T> {
    await db.query('begin')
    try {
      await db.query('set local role authenticated')
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: owner, role: 'authenticated' }),
      ])
      const result = await work()
      await db.query('commit')
      return result
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  }
  try {
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `guidance-owner-${owner}@example.test`],
    )
    const { tenant, seller } = await asOwner(async () => {
      const tenant = (
        await db.query('select create_tenant($1,$2,$3) id', [
          'Payout guidance',
          `guidance-${owner}`,
          randomUUID(),
        ])
      ).rows[0].id as string
      const seller = (
        await db.query('select register_seller($1,$2,$3,$4,$5) id', [
          tenant,
          randomUUID(),
          'Synthetic seller',
          email,
          '',
        ])
      ).rows[0].id as string
      return { tenant, seller }
    })
    const url = `/seller?seller=${seller}`
    await page.setViewportSize({ width: 320, height: 720 })
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      await test.step(locale, async () => {
        const d: Dictionary = JSON.parse(
          readFileSync(
            new URL(`../../messages/${locale}.json`, import.meta.url),
            'utf8',
          ),
        )
        await page.context().addCookies([
          {
            name: 'komisio-locale',
            value: locale,
            url: 'http://127.0.0.1:3000',
          },
        ])
        await page.goto(url)
        const request = page.getByRole('region', {
          name: d.sellerPortal.request,
          exact: true,
        })
        await expect(request).toContainText(d.sellerPortal.noPayoutBalance)
        await expect(request.getByRole('textbox')).toHaveCount(0)
        await expect(request.getByRole('button')).toHaveCount(0)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
      })
    }
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'sv', url: 'http://127.0.0.1:3000' },
      ])
    const adjust = (ore: number) =>
      asOwner(() =>
        db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
          tenant,
          randomUUID(),
          seller,
          ore,
          'Synthetic guidance fixture',
        ]),
      )
    await adjust(5000)
    await page.goto(url)
    const request = page.getByRole('region', {
      name: sv.sellerPortal.request,
      exact: true,
    })
    await expect(request).toContainText(
      sv.sellerPortal.payoutBelowThreshold.replace('{minimum}', '100.00 SEK'),
    )
    await expect(request.getByRole('textbox')).toHaveCount(0)
    await adjust(15000)
    await page.reload()
    const input = request.getByLabel(
      sv.sellerPortal.amount.replace('{currency}', 'SEK'),
      { exact: true },
    )
    const submit = request.getByRole('button', {
      name: sv.sellerPortal.request,
      exact: true,
    })
    await expect(input).toBeVisible()
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/seller/economy'))
        posts.push(r.postData() ?? '')
    })
    for (const [value, error] of [
      ['0', 'INVALID_INPUT'],
      ['1.001', 'INVALID_INPUT'],
      ['50', 'PAYOUT_BELOW_THRESHOLD'],
      ['201', 'PAYOUT_EXCEEDS_BALANCE'],
    ] as const) {
      await input.fill(value)
      await submit.click()
      await expect(request.getByRole('alert')).toHaveText(
        sv.sellerPortal.payoutErrors[error],
      )
      await expect(input).toHaveAttribute('aria-invalid', 'true')
    }
    expect(posts).toHaveLength(0)
    // The browser still sees 200 SEK; the engine now sees 50 SEK.
    await adjust(-15000)
    await input.fill('100')
    const refused = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/seller/economy') &&
        r.request().method() === 'POST',
    )
    await submit.click()
    expect((await refused).status()).toBe(400)
    await expect(request).toHaveCount(1)
    await expect(request.getByRole('alert')).toHaveText(
      sv.sellerPortal.payoutErrors.PAYOUT_EXCEEDS_BALANCE,
    )
    await expect(request.getByRole('textbox')).toHaveCount(0)
    await expect(request).toContainText(
      sv.sellerPortal.payoutBelowThreshold.replace('{minimum}', '100.00 SEK'),
    )
    expect(
      (
        await db.query(
          'select count(*)::int n from payouts where tenant_id=$1 and seller_id=$2',
          [tenant, seller],
        )
      ).rows[0].n,
    ).toBe(0)
    await adjust(15000)
    await page.reload()
    const retryIds: string[] = []
    await page.route('**/api/seller/economy', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action === 'requestPayout') {
        retryIds.push(String(payload.requestId))
        if (retryIds.length === 1) {
          const response = await route.fetch()
          expect(response.ok()).toBe(true)
          // The engine saved the request, but its response never reached the browser.
          await route.abort('failed')
          return
        }
      }
      await route.continue()
    })
    await input.fill('100,00')
    await submit.click()
    await expect(request.getByRole('alert')).toHaveText(sv.sellerPortal.error)
    await expect(input).toHaveValue('100,00')
    await expect(input).toBeDisabled()
    // Saving a different action must not forget the uncertain payout request.
    const emails = page.getByRole('checkbox', { name: sv.sellerPortal.emails })
    const nextPreference = !(await emails.isChecked())
    await emails.setChecked(nextPreference)
    const preferenceSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/seller/economy') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.action === 'notifications',
    )
    await page
      .getByRole('button', { name: sv.sellerPortal.save, exact: true })
      .click()
    expect((await preferenceSaved).ok()).toBe(true)
    await expect(page.getByRole('status')).toHaveText(sv.sellerPortal.saved)
    await expect(emails).toBeChecked({ checked: nextPreference })
    // Wait for refreshed server props, not only the immediate checkbox change.
    await expect(emails).toHaveJSProperty('defaultChecked', nextPreference)
    await expect(input).toHaveValue('100,00')
    await request
      .getByRole('button', { name: sv.intake.retry, exact: true })
      .click()
    await expect(request.getByRole('status')).toHaveText(
      sv.sellerPortal.payoutRequested,
    )
    expect(retryIds).toHaveLength(2)
    expect(retryIds[0]).toBe(retryIds[1])
    const payouts = (
      await db.query(
        'select amount_ore,status,request_source,paid_at from payouts where tenant_id=$1 and seller_id=$2',
        [tenant, seller],
      )
    ).rows
    expect(payouts).toEqual([
      {
        amount_ore: '10000',
        status: 'requested',
        request_source: 'seller',
        paid_at: null,
      },
    ])
    await expect(input).toHaveValue('')
    const payoutList = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: sv.sellerPortal.payouts,
        exact: true,
      }),
    })
    await expect(payoutList).toContainText('100.00 SEK')
    await expect(payoutList).toContainText(sv.payouts.statuses.requested)
    await page.screenshot({
      path: testInfo.outputPath('seller-payout-guidance.png'),
      fullPage: true,
    })
  } finally {
    await db.query('rollback')
    await db.end()
  }
})
