import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
import d from '../../messages/sv.json' with { type: 'json' }

test('policy sections retain fields and reveal invalid controls before publishing', async ({
  page,
}) => {
  const email = `policy-sections-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/settings')
    await expect(page.locator('.policy-section:visible')).toHaveCount(1)
    await expect(page.locator('#policy-section-receiving')).toBeVisible()
    const photo = page.getByRole('checkbox', {
      name: d.submissions.enablePhotos,
      exact: true,
    })
    expect((await photo.boundingBox())!.width).toBeLessThanOrEqual(24)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: 'private/policy-receiving-desktop.png',
      fullPage: true,
    })
    await page
      .locator('.policy-navigation a[href="#policy-section-pricing"]')
      .click()
    await page
      .getByLabel(d.storePolicy.editor.pricingReview, { exact: true })
      .selectOption('per_item')
    await page
      .getByLabel(d.storePolicy.editor.submissionPricing, { exact: true })
      .selectOption('approval')
    await page.screenshot({
      path: 'private/policy-pricing-desktop.png',
      fullPage: true,
    })
    await page
      .locator('.policy-navigation a[href="#policy-section-agreements"]')
      .click()
    await page
      .getByRole('checkbox', { name: d.storePolicy.bag_receipt, exact: true })
      .check()
    await page
      .getByRole('checkbox', {
        name: d.storePolicy.review_publication,
        exact: true,
      })
      .uncheck()
    await page
      .getByRole('checkbox', { name: d.storePolicy.acceptance, exact: true })
      .check()
    await page.screenshot({
      path: 'private/policy-agreements-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 800 })
    await page.screenshot({
      path: 'private/policy-agreements-mobile.png',
      fullPage: true,
    })
    await page
      .locator('.policy-navigation a[href="#policy-section-receiving"]')
      .click()
    const commission = page.getByLabel(d.storePolicy.commissionRatePercent, {
      exact: true,
    })
    await expect(commission).not.toBeVisible()
    await page.screenshot({
      path: 'private/policy-folded-320.png',
      fullPage: true,
      caret: 'initial',
    })
    await page
      .getByRole('link', { name: d.storePolicy.sectionEconomy, exact: true })
      .click()
    await commission.fill('101')
    await page
      .locator('.policy-navigation a[href="#policy-section-receiving"]')
      .click()
    await expect(commission).not.toBeVisible()
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    const requests: unknown[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/intake'))
        requests.push(request.postDataJSON())
    })
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(commission).toBeVisible()
    await expect(commission).toBeFocused()
    expect(requests).toHaveLength(0)
    await commission.fill('55.25')
    await page
      .locator('.policy-navigation a[href="#policy-section-receiving"]')
      .click()
    await page
      .getByRole('link', { name: d.storePolicy.sectionAi, exact: true })
      .click()
    await page
      .getByLabel(d.storePolicy.itemLanguage, { exact: true })
      .selectOption('no')
    await page
      .locator('.policy-navigation a[href="#policy-section-receiving"]')
      .click()
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/intake') &&
        response.request().postDataJSON()?.action === 'publishStorePolicy',
    )
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    expect((await saved).status()).toBe(200)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      policy: {
        commissionRatePercent: 55.25,
        itemLanguage: 'no',
        sellerReviewMode: 'per_item',
        submissionPricing: 'approval',
        agreementRequiredFor: ['bag_receipt', 'acceptance'],
      },
    })
    await page.reload()
    await expect(commission).toHaveValue('55.25')
    await expect(
      page.getByLabel(d.storePolicy.itemLanguage, { exact: true }),
    ).toHaveValue('no')
    // A bookmarked nested field opens its section after a full document load.
    await page.goto('/settings#policy-item-language')
    await expect(
      page.getByLabel(d.storePolicy.itemLanguage, { exact: true }),
    ).toBeInViewport()
    await expect(page.locator('#policy-section-ai')).toBeVisible()
  } finally {
    await f.close()
  }
})

test('policy navigation fits every language and preserves editable controls between sections', async ({
  page,
}) => {
  const email = `policy-locales-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
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
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/settings')
      for (const id of [
        'receiving',
        'pricing',
        'agreements',
        'economy',
        'period',
        'vat',
        'ai',
        'notifications',
      ]) {
        await page
          .locator(`.policy-navigation a[href="#policy-section-${id}"]`)
          .click()
        await expect(page.locator(`#policy-section-${id}`)).toBeVisible()
        await expect(page.locator('.policy-section:visible')).toHaveCount(1)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(320)
      }
      await expect(
        page.getByLabel(d.storePolicy.commissionRatePercent, { exact: true }),
      ).toHaveValue('60')
    }
  } finally {
    await f.close()
  }
})

test('invalid monthly fee opens its section without publishing or losing other edits', async ({
  page,
}) => {
  const email = `policy-fee-validation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings#policy-section-period')
    await page
      .getByLabel(d.storePolicy.consignmentCalendarEnabled, { exact: true })
      .check()
    await page.getByLabel(d.consignmentFees.enabled, { exact: true }).check()
    await page
      .getByLabel(d.consignmentFees.amount, { exact: true })
      .fill('not an amount')
    await page.getByLabel(d.consignmentFees.vatRate, { exact: true }).fill('25')
    await page
      .locator('.policy-navigation a[href="#policy-section-pricing"]')
      .focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#policy-section-pricing')).toBeVisible()
    await page
      .getByLabel(d.storePolicy.editor.submissionPricing, { exact: true })
      .selectOption('seller')
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    let writes = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/intake'))
        writes++
    })
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(page.locator('#policy-section-period')).toBeVisible()
    await expect(
      page.getByLabel(d.consignmentFees.amount, { exact: true }),
    ).toBeFocused()
    await expect(
      page.getByRole('alert').filter({ hasText: d.intake.invalid }),
    ).toBeVisible()
    expect(writes).toBe(0)
    await expect(
      page.getByLabel(d.storePolicy.editor.submissionPricing, { exact: true }),
    ).toHaveValue('seller')
  } finally {
    await f.close()
  }
})
