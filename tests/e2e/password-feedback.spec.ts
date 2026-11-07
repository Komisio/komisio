import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import d from '../../messages/sv.json' with { type: 'json' }

test('account password changes explain a reused password and allow a different password', async ({
  page,
}) => {
  const email = `password-feedback-${randomUUID()}@example.test`
  const password = `K!${randomUUID()}`
  const replacement = `K!${randomUUID()}`
  await register(page, email, password)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/account')
  const form = page
    .locator('form')
    .filter({ has: page.locator('#new-password') })
  await form.getByLabel(d.newPassword, { exact: true }).fill(password)
  await form.getByRole('button', { name: d.savePassword, exact: true }).click()
  await expect(form.getByRole('alert')).toHaveText(d.passwordMustDiffer)
  await expect(form.getByText(d.saved, { exact: true })).toHaveCount(0)
  await form.getByLabel(d.newPassword, { exact: true }).fill(replacement)
  await form.getByRole('button', { name: d.savePassword, exact: true }).click()
  await expect(form.getByText(d.saved, { exact: true })).toBeVisible()
  await expect(form.getByRole('alert')).toHaveCount(0)
  await expect(form.getByLabel(d.newPassword, { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: d.logout, exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel(d.email, { exact: true }).fill(email)
  await page.getByLabel(d.password, { exact: true }).fill(replacement)
  await page.getByRole('button', { name: d.login, exact: true }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
})
