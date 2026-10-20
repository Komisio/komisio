import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { localTestUrl } from '../helpers/local-services'
import sv from '../../messages/sv.json' with { type: 'json' }
import dk from '../../messages/dk.json' with { type: 'json' }

test('saving Danish account language changes the next real Auth recovery mail even from a Swedish page', async ({
  page,
  baseURL,
}) => {
  const email = `account-mail-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  // No store membership is required to choose personal account language.
  await page.goto('/account')
  await page.locator('#profile-language').selectOption('dk')
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/platform') && r.request().method() === 'POST',
  )
  await page
    .locator('form')
    .filter({ has: page.locator('#profile-language') })
    .getByRole('button', { name: sv.save, exact: true })
    .click()
  expect((await saved).status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'da-DK')
  await expect(page.locator('#profile-language')).toHaveValue('dk')
  // A different UI/cookie language is not the account's email preference.
  await page
    .context()
    .addCookies([{ name: 'komisio-locale', value: 'sv', url: baseURL! }])
  await page.goto('/reset-password')
  await page.getByLabel(sv.email, { exact: true }).fill(email)
  await page.getByRole('button', { name: sv.sendReset, exact: true }).click()
  await expect(page.getByText(sv.resetSent, { exact: true })).toBeVisible()
  const mailUrl = localTestUrl('TEST_MAIL_URL', 'http://127.0.0.1:54324')
  let messageId = ''
  await expect
    .poll(async () => {
      const inbox = await (
        await page.request.get(`${mailUrl}/api/v1/messages`)
      ).json()
      const message = inbox.messages?.find(
        (m: { ID: string; To: { Address: string }[]; Subject: string }) =>
          m.To.some((t) => t.Address === email) &&
          m.Subject === dk.authEmail.recovery.subject,
      )
      messageId = message?.ID ?? ''
      return !!messageId
    })
    .toBe(true)
  const mail = await (
    await page.request.get(`${mailUrl}/api/v1/message/${messageId}`)
  ).json()
  expect(mail.Text).toContain(dk.authEmail.recovery.intro)
  expect(mail.Text).toContain(dk.authEmail.recovery.button)
  expect(mail.Text).toContain(dk.authEmail.recovery.note)
  expect(mail.Text).toContain('type=recovery')
  expect(mail.HTML.match(/<a href=/g)).toHaveLength(1)
})
