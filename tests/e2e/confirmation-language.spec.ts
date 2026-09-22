import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { confirmationCopy } from '../../scripts/confirmation-template.mjs'
import { confirmEmail } from '../helpers/account'

for (const locale of Object.keys(
  confirmationCopy,
) as (keyof typeof confirmationCopy)[]) {
  test(`signup confirmation subject, body and link in ${locale}`, async ({
    page,
  }) => {
    const d = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'))
    const email = `confirm-${locale}-${randomUUID().slice(0, 8)}@example.test`
    await page.goto(`/register?lang=${locale}`)
    await page.getByLabel(d.email, { exact: true }).fill(email)
    await page.getByLabel(d.password, { exact: true }).fill(`K!${randomUUID()}`)
    const signup = page.waitForRequest(
      (r) => r.url().includes('/auth/v1/signup') && r.method() === 'POST',
    )
    await page.getByRole('button', { name: d.register, exact: true }).click()
    expect((await signup).postDataJSON().data.locale).toBe(locale)
    await expect(page.getByText(d.verifySent)).toBeVisible()
    await expect
      .poll(async () => {
        const inbox = await (
          await page.request.get('http://127.0.0.1:54324/api/v1/messages')
        ).json()
        const message = inbox.messages?.find(
          (m: { To: { Address: string }[] }) =>
            m.To.some((t) => t.Address === email),
        )
        if (!message) return false
        expect(message.Subject).toBe(`Komisio – ${confirmationCopy[locale][0]}`)
        const detail = await (
          await page.request.get(
            `http://127.0.0.1:54324/api/v1/message/${message.ID}`,
          )
        ).json()
        expect(detail.HTML).toContain(confirmationCopy[locale][1])
        expect(detail.HTML).toContain(confirmationCopy[locale][2])
        expect(detail.HTML).not.toContain('{{')
        return true
      })
      .toBe(true)
    await confirmEmail(page, email)
    await expect(page).toHaveURL(/\/onboarding$/)
  })
}
