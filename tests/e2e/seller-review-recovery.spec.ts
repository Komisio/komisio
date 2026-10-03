import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function reviewFixture(page: Page, withPhoto = false) {
  const email = `review-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic review seller',
        email,
        '',
      ])
    ).rows[0].id
    const session = randomUUID(),
      observation = randomUUID(),
      price = randomUUID(),
      review = randomUUID()
    await f.db.query('select create_reception_session($1,$2,$3)', [
      f.tenant,
      session,
      seller,
    ])
    await f.commit()
    const token = randomBytes(32).toString('hex')
    const photoId = withPhoto ? randomUUID() : null
    let photoSource: object | null = null
    if (photoId) {
      const image = await sharp({
        create: { width: 32, height: 48, channels: 3, background: '#24649b' },
      })
        .png()
        .toBuffer()
      const uploaded = await page.request.post(
        `/api/reception/${session}/photo?tenant=${f.tenant}&photo=${photoId}`,
        {
          headers: {
            Origin: new URL(page.url()).origin,
            'Content-Type': 'image/png',
          },
          data: image,
        },
      )
      expect(uploaded.status()).toBe(200)
      photoSource = (await uploaded.json()).source
    }
    await f.asActor(f.actor, async () => {
      await f.db.query('select save_reception_sources($1,$2,$3,0,$4)', [
        f.tenant,
        randomUUID(),
        session,
        JSON.stringify([
          ...(photoSource ? [photoSource] : []),
          {
            id: observation,
            kind: 'observation',
            reference: 'Staff observation',
            observation: 'Synthetic blue coat',
          },
          {
            id: price,
            kind: 'price-evidence',
            reference: 'Staff price proposal',
            observation: 'Synthetic 250 SEK',
          },
        ]),
      ])
      await f.db.query(
        "select publish_reception_review($1,$2,$3,1,null,$4,$5,now()+interval '1 day')",
        [
          f.tenant,
          review,
          session,
          f.agreement,
          JSON.stringify({
            attributes: [
              {
                slug: 'description',
                definitionVersion: 1,
                value: 'Synthetic blue coat',
                sourceIds: [observation],
                certainty: 'observed',
              },
            ],
            price: {
              currency: 'SEK',
              amount: '250.00',
              rationale: 'Synthetic price proposal',
              sourceIds: [price],
            },
            questions: [],
          }),
        ],
      )
      await f.db.query('select set_reception_access($1,$2,$3,null,$4)', [
        f.tenant,
        randomUUID(),
        review,
        createHash('sha256').update(token).digest('hex'),
      ])
    })
    await page.goto(`/review/${token}`)
    await expect(
      page.getByText('Synthetic blue coat', { exact: true }),
    ).toBeVisible()
    return { f, review, token, photoId }
  } catch (error) {
    await f.close()
    throw error
  }
}

for (const decision of ['approve', 'decline'] as const)
  test(`an unconfirmed ${decision} keeps its identity and cannot turn into the opposite response`, async ({
    page,
  }) => {
    const { f, review } = await reviewFixture(page)
    try {
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/seller/review', async (route) => {
        requests.push(route.request().postDataJSON())
        if (requests.length === 1)
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'REQUEST_FAILED' }),
          })
        else {
          const response = await route.fetch()
          expect(response.status()).toBe(200)
          await route.fulfill({ response })
        }
      })
      await page
        .getByRole('checkbox', { name: d.reviewConfirm, exact: true })
        .check()
      await page
        .getByRole('button', {
          name: decision === 'approve' ? d.reviewApprove : d.reviewDecline,
          exact: true,
        })
        .click()
      await expect(page.locator('main').getByRole('alert')).toHaveText(
        d.reviewResponseError,
      )
      await expect(
        page.getByRole('button', {
          name: decision === 'approve' ? d.reviewDecline : d.reviewApprove,
          exact: true,
        }),
      ).toBeDisabled()
      await expect(
        page.getByRole('checkbox', { name: d.reviewConfirm, exact: true }),
      ).toBeDisabled()
      await page
        .getByRole('button', {
          name:
            decision === 'approve'
              ? d.reviewRetryApprove
              : d.reviewRetryDecline,
          exact: true,
        })
        .click()
      await expect(page.getByRole('status')).toHaveText(
        decision === 'approve' ? d.reviewApproved : d.reviewDeclined,
      )
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      expect(
        (
          await f.db.query(
            'select id,decision from reception_responses where review_id=$1',
            [review],
          )
        ).rows,
      ).toEqual([{ id: requests[0].requestId, decision }])
    } finally {
      await f.close()
    }
  })

for (const reply of ['committed-lost', 'wrong-id', 'server-invalid'] as const)
  test(`a ${reply} seller review response retains the exact command`, async ({
    page,
  }) => {
    const { f, review } = await reviewFixture(page)
    try {
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/seller/review', async (route) => {
        requests.push(route.request().postDataJSON())
        const result = await route.fetch()
        expect(result.status()).toBe(200)
        if (requests.length === 1)
          await route.fulfill({
            status: reply === 'wrong-id' ? 200 : 503,
            contentType: 'application/json',
            body: JSON.stringify(
              reply === 'wrong-id'
                ? { id: randomUUID() }
                : {
                    error:
                      reply === 'server-invalid'
                        ? 'INVALID_INPUT'
                        : 'REQUEST_FAILED',
                  },
            ),
          })
        else await route.fulfill({ response: result })
      })
      await page
        .getByRole('checkbox', { name: d.reviewConfirm, exact: true })
        .check()
      await page
        .getByRole('button', { name: d.reviewApprove, exact: true })
        .click()
      await expect(page.locator('main').getByRole('alert')).toHaveText(
        d.reviewResponseError,
      )
      await expect(page.getByRole('status')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: d.reviewDecline, exact: true }),
      ).toBeDisabled()
      await page
        .getByRole('button', { name: d.reviewRetryApprove, exact: true })
        .click()
      await expect(page.getByRole('status')).toHaveText(d.reviewApproved)
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      expect(
        (
          await f.db.query(
            'select id,decision from reception_responses where review_id=$1',
            [review],
          )
        ).rows,
      ).toEqual([{ id: requests[0].requestId, decision: 'approve' }])
    } finally {
      await f.close()
    }
  })

test('a revoked review link offers reload and cannot keep retrying a stale decision', async ({
  page,
}) => {
  const { f, review } = await reviewFixture(page)
  try {
    await f.asActor(f.actor, async () => {
      const prior = (
        await f.db.query(
          'select id from reception_access_events where review_id=$1 order by version desc limit 1',
          [review],
        )
      ).rows[0].id
      await f.db.query('select set_reception_access($1,$2,$3,$4,null)', [
        f.tenant,
        randomUUID(),
        review,
        prior,
      ])
    })
    await page
      .getByRole('button', { name: d.reviewDecline, exact: true })
      .click()
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      d.reviewResponseError,
    )
    await expect(
      page.getByRole('button', { name: d.reviewRetryDecline, exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(d.reviewUnavailable)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_responses where review_id=$1',
          [review],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('a failed authenticated review photo offers recovery and approval waits for a loaded image and confirmation', async ({
  page,
}, testInfo) => {
  let block = true
  await page.route('**/api/seller/review/*/photo/*', (route) =>
    block ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  )
  const { f, review } = await reviewFixture(page, true)
  try {
    await page.setViewportSize({ width: 320, height: 800 })
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      d.reviewPhotoError,
    )
    await page
      .getByRole('checkbox', { name: d.reviewConfirm, exact: true })
      .check()
    await expect(
      page.getByRole('button', { name: d.reviewApprove, exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: d.reviewDecline, exact: true }),
    ).toBeEnabled()
    block = false
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect
      .poll(() =>
        page
          .locator('.reception-photos img')
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true)
    await expect(
      page.getByRole('checkbox', { name: d.reviewConfirm, exact: true }),
    ).not.toBeChecked()
    await expect(
      page.getByRole('button', { name: d.reviewApprove, exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('checkbox', { name: d.reviewConfirm, exact: true })
      .check()
    await expect(
      page.getByRole('button', { name: d.reviewApprove, exact: true }),
    ).toBeEnabled()
    const photo = (await page.locator('.reception-photos img').boundingBox())!
    const description = (await page
      .getByText('Synthetic blue coat', { exact: true })
      .boundingBox())!
    const terms = (await page
      .getByRole('heading', { name: 'Synthetic terms', exact: true })
      .boundingBox())!
    const confirmation = (await page
      .getByRole('checkbox', { name: d.reviewConfirm, exact: true })
      .boundingBox())!
    expect(photo.y + photo.height).toBeLessThanOrEqual(description.y)
    expect(description.y).toBeLessThan(terms.y)
    expect(terms.y).toBeLessThan(confirmation.y)
    const expiry = page.locator('main time')
    await expect(expiry).toHaveAttribute('datetime', /T/)
    await expect(expiry).not.toContainText(/\d{1,2}:\d{2}:\d{2}/)
    await page.screenshot({
      path: testInfo.outputPath('seller-review-photo-320.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_responses where review_id=$1',
          [review],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('review retry controls remain visible and readable on a phone in every language', async ({
  page,
}, testInfo) => {
  const { f, review, token } = await reviewFixture(page)
  try {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.route('**/api/seller/review', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      }),
    )
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const dictionary: Dictionary = JSON.parse(
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
      await page.goto(`/review/${token}?localeCheck=${locale}`)
      await page
        .getByRole('button', { name: dictionary.reviewDecline, exact: true })
        .click()
      await expect(page.locator('main').getByRole('alert')).toHaveText(
        dictionary.reviewResponseError,
      )
      await expect(page.locator('main').getByRole('alert')).toBeFocused()
      const retry = page.getByRole('button', {
        name: dictionary.reviewRetryDecline,
        exact: true,
      })
      await expect(retry).toBeEnabled()
      const bounds = (await retry.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      if (locale === 'sv')
        await page.screenshot({
          path: testInfo.outputPath('seller-review-retry-320.png'),
          fullPage: true,
        })
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_responses where review_id=$1',
          [review],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
