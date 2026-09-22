import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import d from '../../messages/sv.json' with { type: 'json' }
test('store creation waits for JavaScript before enabling submission', async ({
  page,
  browser,
}) => {
  await register(
    page,
    `tenant-ready-${randomUUID()}@example.test`,
    `K!${randomBytes(16).toString('hex')}`,
  )
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
  })
  try {
    const serverPage = await context.newPage()
    await serverPage.goto('http://127.0.0.1:3000/onboarding')
    await expect(
      serverPage.getByRole('button', { name: d.createButton, exact: true }),
    ).toBeDisabled()
  } finally {
    await context.close()
  }
  await page.getByLabel(d.tenantName, { exact: true }).fill('Ready store')
  await page.getByRole('button', { name: d.createButton, exact: true }).click()
  await expect(page.getByLabel(d.activeTenant).first()).toBeVisible()
  expect(page.url()).not.toContain('?name=')
})
