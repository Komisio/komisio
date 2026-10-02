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
    await expect(page.locator('.policy-section > details[open]')).toHaveCount(1)
    await expect(
      page.locator('#policy-section-receiving > details'),
    ).toHaveAttribute('open', '')
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
    await page.locator('#policy-section-economy summary').click()
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
    await page.locator('#policy-section-economy summary').click()
    await page
      .getByRole('link', { name: d.storePolicy.sectionAi, exact: true })
      .click()
    await page
      .getByLabel(d.storePolicy.itemLanguage, { exact: true })
      .selectOption('no')
    await page.locator('#policy-section-ai summary').click()
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
      policy: { commissionRatePercent: 55.25, itemLanguage: 'no' },
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
    await expect(page.locator('#policy-section-ai > details')).toHaveAttribute(
      'open',
      '',
    )
  } finally {
    await f.close()
  }
})

test('policy section summaries fit every language and preserve editable controls when toggled', async ({
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
        'economy',
        'period',
        'vat',
        'ai',
        'notifications',
      ]) {
        const details = page.locator(`#policy-section-${id} > details`)
        if (
          !(await details.evaluate(
            (element) => (element as HTMLDetailsElement).open,
          ))
        )
          await details.locator('summary').click()
        await expect(details).toHaveAttribute('open', '')
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(320)
        await details.locator('summary').click()
      }
      await expect(
        page.getByLabel(d.storePolicy.commissionRatePercent, { exact: true }),
      ).toHaveValue('60')
    }
  } finally {
    await f.close()
  }
})
