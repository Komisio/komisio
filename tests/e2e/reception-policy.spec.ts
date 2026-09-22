import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
async function prepare(page: Page) {
  await page
    .getByLabel(d.reception.description, { exact: true })
    .fill('Synthetic sweater')
  await page.getByLabel(d.reception.price, { exact: true }).fill('120')
  await page
    .getByLabel(d.reception.reference, { exact: true })
    .fill('Synthetic appraisal')
  await page
    .getByLabel(d.reception.rationale, { exact: true })
    .fill('Synthetic condition')
  await page
    .getByRole('button', { name: d.reception.saveSources, exact: true })
    .click()
  await expect(page.locator('input[name="review-final"]')).toBeVisible()
}
test('optional agreement and delegated pricing show staff review and completed registration', async ({
  page,
}) => {
  const email = `reception-policy-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const tenant = (
      await f.db.query('select create_tenant($1,$2,$3) id', [
        'No agreement store',
        'policy-' + randomUUID(),
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        tenant,
        randomUUID(),
        'Synthetic seller',
        'synthetic@example.test',
        '',
      ])
    ).rows[0].id
    const session = (
      await f.db.query('select create_reception_session($1,$2,$3) id', [
        tenant,
        randomUUID(),
        seller,
      ])
    ).rows[0].id
    await f.commit()
    const selected = await page.request.post('/api/platform', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: { action: 'select', tenantId: tenant },
    })
    expect(selected.ok()).toBe(true)
    await page.goto('/intake/reception/' + session)
    await prepare(page)
    await expect(
      page.getByText(d.reception.needTerms, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(d.storePolicy.noTerms, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(d.reception.storeReview.confirmNoTerms, { exact: true }),
    ).toBeVisible()
    await page.locator('input[name="review-final"]').check()
    await page
      .getByRole('button', {
        name: d.reception.storeReview.publish,
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('heading', {
        name:
          d.reception.storeReview.title + ' — ' + d.reception.version + ' 1',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(d.reception.awaiting, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(d.reception.needSources, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(d.reception.storeReview.noApproval, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(d.reviewExpires, { exact: false })).toHaveCount(
      0,
    )
    const received = await page.request.post('/api/intake/quick', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: {
        tenantId: tenant,
        requestId: randomUUID(),
        sellerId: seller,
        sessionId: null,
        expectedRevision: 0,
        facts: { description: 'Synthetic registered sweater' },
        priceOre: 12000,
      },
    })
    expect(received.ok()).toBe(true)
    const result = await received.json()
    await page.goto('/intake/reception/' + result.sessionId)
    await expect(
      page.getByRole('heading', {
        name: d.reception.storeReview.registered,
        exact: true,
      }),
    ).toBeVisible()
    for (const text of [
      d.storePolicy.noTerms,
      d.reception.awaiting,
      d.reception.needSources,
      d.reception.workspace.custodyHint,
    ])
      await expect(page.getByText(text, { exact: true })).toHaveCount(0)
    await expect(page.locator('.reception-step').nth(0)).not.toHaveAttribute(
      'open',
      '',
    )
    await expect(page.locator('.reception-step').nth(1)).not.toHaveAttribute(
      'open',
      '',
    )
    await expect(
      page.getByRole('link', { name: d.items.open, exact: true }).first(),
    ).toHaveAttribute('href', '/intake/items/' + result.itemId)
    await page.screenshot({
      path: 'private/reception-policy-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/reception-policy-mobile.png',
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
test('per-item seller approval and required agreements remain visible', async ({
  page,
}) => {
  const email = `reception-required-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      'select publish_store_policy($1,$2,(current_store_policy($1)->>\'id\')::uuid,(current_store_policy($1)->\'policy\')||\'{"sellerReviewMode":"per_item","agreementRequiredFor":["review_publication","acceptance"]}\')',
      [f.tenant, randomUUID()],
    )
    const session = (
      await f.db.query('select create_reception_session($1,$2,$3) id', [
        f.tenant,
        randomUUID(),
        f.seller,
      ])
    ).rows[0].id
    await f.commit()
    await page.goto('/intake/reception/' + session)
    await prepare(page)
    await expect(
      page.getByText(d.reception.confirm, { exact: true }),
    ).toBeVisible()
    await page.locator('input[name="review-final"]').check()
    await page
      .getByRole('button', { name: d.reception.publish, exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: d.reception.sellerStep + ' — ' + d.reception.version + ' 1',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(d.reception.awaiting, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: d.reception.issueLink, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(d.reception.storeReview.noApproval, { exact: true }),
    ).toHaveCount(0)
  } finally {
    await f.close()
  }
})
