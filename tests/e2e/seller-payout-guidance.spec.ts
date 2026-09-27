import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import sv from '../../messages/sv.json' with { type: 'json' }

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
    await submit.click()
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
