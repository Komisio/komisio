import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import en from '../../messages/en.json' with { type: 'json' }

test('saved message language works without a public profile and ignores the staff UI language', async ({
  page,
  baseURL,
}, info) => {
  const email = `mail-language-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page
      .context()
      .addCookies([{ name: 'komisio-locale', value: 'en', url: baseURL! }])
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/members')
    await expect(page.locator('#invite-locale')).toHaveValue('en')
    const send = async () => {
      const id = randomUUID()
      const response = await page.request.post('/api/communications', {
        headers: { Origin: new URL(baseURL!).origin },
        data: {
          tenantId: f.tenant,
          requestId: id,
          sellerId: f.seller,
          kind: 'message',
          freeText: 'Synthetic unchanged note',
        },
      })
      expect(response.status()).toBe(200)
      return (
        await f.db.query(
          'select id,locale,subject,body from seller_communications where tenant_id=$1 and id=$2',
          [f.tenant, id],
        )
      ).rows[0]
    }
    const original = await send()
    expect(original.locale).toBe('en')
    expect(original.subject).toBe('Message from P2 browser store')
    await page.goto('/settings#policy-communication-language')
    const language = page.getByLabel(en.storePolicy.communicationLanguage, {
      exact: true,
    })
    await expect(language).toBeVisible()
    await expect(language).toHaveValue('en')
    const period = page.getByLabel(en.periodNotices.setting, { exact: true })
    const ordinary = page.getByLabel(
      en.storePolicy.automaticSellerNotifications,
      { exact: true },
    )
    await expect(period).toBeChecked()
    await expect(ordinary).not.toBeChecked()
    await period.uncheck()
    await expect(language.locator('option')).toHaveCount(8)
    const publishLanguage = async (locale: 'sv' | 'dk') => {
      await language.selectOption(locale)
      await page.getByLabel(en.storePolicy.confirm, { exact: true }).check()
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake') && r.request().method() === 'POST',
      )
      await page
        .getByRole('button', { name: en.storePolicy.publish, exact: true })
        .click()
      expect((await saved).status()).toBe(200)
      await page.goto('/settings#policy-communication-language')
      await expect(language).toHaveValue(locale)
      await expect(language).toBeVisible()
      await expect(language).toBeEnabled()
    }
    await publishLanguage('sv')
    await expect(period).not.toBeChecked()
    await expect(ordinary).not.toBeChecked()
    await period.check()
    const swedish = await send()
    expect(swedish.locale).toBe('sv')
    expect(swedish.subject).toBe('Meddelande från P2 browser store')
    await publishLanguage('dk')
    await expect(period).toBeChecked()
    await expect(ordinary).not.toBeChecked()
    await page.setViewportSize({ width: 320, height: 800 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)
    await page.screenshot({
      path: info.outputPath('message-language-320.png'),
      fullPage: true,
    })
    await page.goto('/members')
    await expect(page.locator('#invite-locale')).toHaveValue('dk')
    await page.goto(`/intake/sellers/${f.seller}#seller-details`)
    await expect(
      page
        .getByText(`${en.sellerDetails.followStore} (Dansk)`, { exact: false })
        .first(),
    ).toBeVisible()
    const danish = await send()
    expect(danish.locale).toBe('dk')
    expect(danish.subject).toBe('Besked fra P2 browser store')
    expect(danish.body).toContain('Hej Synthetic P2 seller,')
    expect(danish.body).toContain('Synthetic unchanged note')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from store_profile_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await f.db.query(
          'select id,locale,subject,body from seller_communications where tenant_id=$1 and id=$2',
          [f.tenant, original.id],
        )
      ).rows[0],
    ).toEqual(original)
  } finally {
    await f.close()
  }
})
