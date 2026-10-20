import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
const dictionary = (locale: string): Dictionary =>
  JSON.parse(
    readFileSync(
      new URL(`../../messages/${locale}.json`, import.meta.url),
      'utf8',
    ),
  )

test('invitation language defaults to the store, stays accessible in every UI language, and is submitted explicitly', async ({
  page,
  baseURL,
}, info) => {
  const email = `invitation-language-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/members')
    await expect(page.locator('#invite-locale')).toHaveValue('en')
    const published = await page.request.post('/api/intake', {
      headers: { Origin: new URL(baseURL!).origin },
      data: {
        action: 'publishStoreProfile',
        tenantId: f.tenant,
        requestId: randomUUID(),
        expectedCurrentId: null,
        profile: {
          address: { street: '', postalCode: '', city: '' },
          contact: { email: '', phone: '', website: '' },
          openingHours: [],
          accepts: '',
          concept: '',
          language: 'dk',
        },
      },
    })
    expect(published.status()).toBe(200)
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of locales) {
      const d = dictionary(locale)
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: baseURL! }])
      await page.goto('/members')
      await page.waitForLoadState('networkidle')
      const select = page.getByLabel(d.inviteLanguage, { exact: true })
      await expect(select).toHaveValue('dk')
      await expect(select.locator('option')).toHaveCount(8)
      await page.locator('#invite-role').focus()
      await page.keyboard.press('Tab')
      await expect(select).toBeFocused()
      await select.selectOption('fi')
      await expect(select).toHaveValue('fi')
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      await page.screenshot({
        path: info.outputPath(`invitation-${locale}.png`),
        fullPage: true,
      })
    }
    await page.locator('#invite-email').fill('synthetic-colleague@example.test')
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/platform') && r.request().method() === 'POST',
    )
    await page
      .getByRole('button', { name: dictionary('it').invite, exact: true })
      .click()
    const result = await response
    expect(result.request().postDataJSON().locale).toBe('fi')
    expect(result.status()).toBe(200)
    expect((await result.json()).inviteUrl).toContain('/invite/')
    // The Italian staff session must not leak into the seller's Danish mail.
    const messageId = randomUUID()
    const sent = await page.request.post('/api/communications', {
      headers: { Origin: new URL(baseURL!).origin },
      data: {
        tenantId: f.tenant,
        requestId: messageId,
        sellerId: f.seller,
        kind: 'message',
        freeText: 'Synthetic free text, kept as written.',
      },
    })
    expect(sent.status()).toBe(200)
    const row = (
      await f.db.query(
        'select locale,template_version,subject,body from seller_communications where tenant_id=$1 and id=$2',
        [f.tenant, messageId],
      )
    ).rows[0]
    expect(row.locale).toBe('dk')
    expect(row.template_version).toBe('v2')
    expect(row.subject).toBe('Besked fra P2 browser store')
    expect(row.body).toContain('Hej Synthetic P2 seller,')
    expect(row.body).toContain('Synthetic free text, kept as written.')
  } finally {
    await f.close()
  }
})
