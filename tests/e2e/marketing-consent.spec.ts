import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { confirmEmail } from '../helpers/account'

test('optional signup choice persists and can be withdrawn under Account', async ({
  page,
}, testInfo) => {
  const email = `marketing-${randomUUID()}@example.test`
  await page.goto('/register?next=/account')
  const checkbox = page.locator('input[name="marketingConsent"]')
  await expect(checkbox).toBeVisible()
  await expect(checkbox).not.toBeChecked()
  await expect(checkbox).not.toHaveAttribute('required')
  await page.getByLabel('E-postadress', { exact: true }).fill(email)
  await page.getByLabel('Lösenord', { exact: true }).fill(`K!${randomUUID()}`)
  await checkbox.check()
  await page.getByRole('button', { name: 'Skapa konto', exact: true }).click()
  await expect(
    page.getByText('Kontrollera din e-post och följ länken'),
  ).toBeVisible()
  await confirmEmail(page, email)
  await expect(page).toHaveURL(/\/account$/)
  const choice = page.locator('input[name="marketingConsent"]')
  await expect(choice).toBeChecked()
  await choice.uncheck()
  const form = page.locator('form').filter({ has: choice })
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/platform') && r.request().method() === 'POST',
  )
  await form
    .getByRole('button', { name: 'Spara e-postval', exact: true })
    .click()
  expect((await response).ok()).toBe(true)
  await page.reload()
  await expect(choice).not.toBeChecked()
  await page.setViewportSize({ width: 375, height: 812 })
  for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
    const d = JSON.parse(
      readFileSync(
        new URL(`../../messages/${locale}.json`, import.meta.url),
        'utf8',
      ),
    )
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: locale,
        url: new URL(page.url()).origin,
      },
    ])
    await page.reload()
    await expect(page.getByLabel(d.marketingConsentLabel)).not.toBeChecked()
    await expect(
      page.getByText(d.marketingConsentHelp, { exact: true }),
    ).toBeVisible()
  }
  await page.screenshot({
    path: testInfo.outputPath('account-mobile.png'),
    fullPage: true,
  })
})
