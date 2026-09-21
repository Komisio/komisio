import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import d from '../../messages/sv.json' with { type: 'json' }

test('reception guides the operator through three steps and preserves manual input', async ({
  page,
}) => {
  const email = `workspace-${randomUUID()}@example.test`
  await register(page, email, `Test!${randomUUID()}`)
  await page.getByLabel('Butikens namn').fill('TEST Reception workspace')
  await page
    .getByLabel('Butikens identifierare')
    .fill(`workspace-${randomUUID()}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenant = await page.getByLabel('Aktiv butik').first().inputValue()
  const sellerResponse = await page.request.post('/api/intake', {
    headers: { origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'registerSeller',
      tenantId: tenant,
      requestId: randomUUID(),
      name: 'TEST Workspace seller',
      email: '',
      phone: '00000',
    },
  })
  expect(sellerResponse.status()).toBe(200)
  const seller = await sellerResponse.json()
  const response = await page.request.post('/api/intake', {
    headers: { origin: 'http://127.0.0.1:3000' },
    data: {
      action: 'createReception',
      tenantId: tenant,
      sellerId: seller.id,
      requestId: randomUUID(),
    },
  })
  expect(response.status()).toBe(200)
  const { id } = await response.json()
  await page.goto(`/intake/reception/${id}`)
  const steps = page.locator('.reception-step')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(0)).toHaveAttribute('open', '')
  await expect(steps.nth(1)).not.toHaveAttribute('open', '')
  await expect(steps.nth(2)).not.toHaveAttribute('open', '')
  await page
    .getByLabel(d.reception.description, { exact: true })
    .fill('Synthetic desk lamp')
  await page.getByLabel(d.reception.price, { exact: true }).fill('250')
  await page
    .getByLabel(d.reception.reference, { exact: true })
    .fill('Staff appraisal')
  await page
    .getByLabel(d.reception.rationale, { exact: true })
    .fill('Synthetic condition and price assessment')
  await steps.nth(0).locator(':scope > summary').click()
  await steps.nth(0).locator(':scope > summary').click()
  await expect(
    page.getByLabel(d.reception.description, { exact: true }),
  ).toHaveValue('Synthetic desk lamp')
  await page
    .getByRole('button', { name: d.reception.saveSources, exact: true })
    .click()
  await expect(steps.nth(1)).toHaveAttribute('open', '')
  await expect(steps.nth(1)).toContainText('Synthetic desk lamp')
  await expect(steps.nth(2)).not.toHaveAttribute('open', '')
  await page.screenshot({
    path: 'private/reception-workspace-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'private/reception-workspace-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
