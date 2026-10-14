import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import all from '../../messages/sv.json' with { type: 'json' }
const d = all.sellerPrivacy
const reviewOn = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

test('reviewed contact erasure safely retries a lost response and records follow-up', async ({
  page,
}, testInfo) => {
  const email = `privacy-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-details`)
    await page.getByRole('link', { name: d.title, exact: true }).click()
    await expect(page.getByRole('heading', { name: d.title })).toBeVisible()
    await page
      .getByLabel(d.reason, { exact: true })
      .fill('Synthetic agreement evidence requires further review')
    await page.getByLabel(d.reviewOn, { exact: true }).fill(reviewOn)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: d.continue, exact: true }).click()
    expect(
      (
        await f.db.query('select privacy_closed_at from sellers where id=$1', [
          f.seller,
        ])
      ).rows[0].privacy_closed_at,
    ).toBeNull()
    await page.screenshot({
      path: testInfo.outputPath('privacy-desktop.png'),
      fullPage: true,
    })
    const requests: unknown[] = []
    let first = true
    await page.route(`**/api/sellers/${f.seller}/privacy`, async (route) => {
      requests.push(route.request().postDataJSON())
      if (first) {
        first = false
        const result = await route.fetch()
        expect(result.status()).toBe(200)
        await route.abort()
      } else await route.continue()
    })
    await page.getByRole('button', { name: d.erase, exact: true }).click()
    await expect(page.getByText(d.uncertain, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: d.retry, exact: true }).click()
    await expect(
      page.getByRole('heading', { name: d.followUp, exact: true }),
    ).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    const saved = (
      await f.db.query(
        'select email,phone,profile,privacy_closed_at from sellers where id=$1',
        [f.seller],
      )
    ).rows[0]
    expect(saved.email).toBe('')
    expect(saved.phone).toBe('')
    expect(saved.profile).toBeNull()
    expect(saved.privacy_closed_at).not.toBeNull()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_privacy_events where seller_id=$1',
          [f.seller],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_evidence where seller_id=$1',
          [f.seller],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('privacy-mobile.png'),
      fullPage: true,
    })
    await page
      .getByLabel(d.reason, { exact: true })
      .fill('Synthetic follow-up: agreement retention still necessary')
    await page.getByLabel(d.reviewOn, { exact: true }).fill(reviewOn)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: d.saveReview, exact: true }).click()
    await expect(
      page.getByText(
        'Synthetic follow-up: agreement retention still necessary',
        { exact: true },
      ),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_privacy_events where seller_id=$1',
          [f.seller],
        )
      ).rows[0].n,
    ).toBe(2)
    await page.goto(`/intake/sellers/${f.seller}`)
    await expect(
      page.getByRole('heading', { name: d.closedName, exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

test('new financial activity invalidates an open erasure preview', async ({
  page,
}) => {
  const email = `privacy-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}/privacy`)
    const command = {
      action: 'erase',
      tenantId: f.tenant,
      sellerId: f.seller,
      requestId: randomUUID(),
      revision: 'a'.repeat(64),
      reason: 'Synthetic reviewed evidence',
      reviewOn,
      confirmed: true,
    }
    for (const [headers, data, expected] of [
      [{ Origin: 'https://different.example.test' }, command, 403],
      [
        { Origin: 'http://127.0.0.1:3000' },
        { ...command, tenantId: randomUUID() },
        409,
      ],
      [
        { Origin: 'http://127.0.0.1:3000' },
        { ...command, sellerId: randomUUID() },
        400,
      ],
      [
        { Origin: 'http://127.0.0.1:3000' },
        { ...command, confirmed: false },
        400,
      ],
    ] as const) {
      const response = await page.request.post(
        `/api/sellers/${f.seller}/privacy`,
        { headers, data },
      )
      expect(response.status()).toBe(expected)
      expect(response.headers()['cache-control']).toBe('private, no-store')
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_privacy_events where seller_id=$1',
          [f.seller],
        )
      ).rows[0].n,
    ).toBe(0)
    await page
      .getByLabel(d.reason, { exact: true })
      .fill('Synthetic evidence reviewed before financial activity')
    await page.getByLabel(d.reviewOn, { exact: true }).fill(reviewOn)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: d.continue, exact: true }).click()
    await f.asActor(f.actor, () =>
      f.db.query('select adjust_seller_ledger($1,$2,$3,100,$4)', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic new activity',
      ]),
    )
    await page.getByRole('button', { name: d.erase, exact: true }).click()
    await expect(page.getByText(d.changed, { exact: true })).toBeVisible()
    expect(
      (
        await f.db.query('select privacy_closed_at from sellers where id=$1', [
          f.seller,
        ])
      ).rows[0].privacy_closed_at,
    ).toBeNull()
    await page.getByRole('button', { name: d.reload, exact: true }).click()
    await expect(
      page.getByText(d.blockers.balance, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.continue, exact: true }),
    ).toBeDisabled()
  } finally {
    await f.close()
  }
})
