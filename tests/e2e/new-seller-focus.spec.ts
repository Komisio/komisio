import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('intake registration opens empty each time, without search prefill', async ({
  page,
}, testInfo) => {
  const email = `seller-focus-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake')
    await page.locator('#seller-search').fill('search-only@example.test')
    await expect(
      page.getByText(d.intake.noSellers, { exact: true }),
    ).toBeVisible()
    const name = page.getByRole('textbox', { name: d.intake.name, exact: true })
    await expect(name).not.toBeVisible()
    const open = page.getByRole('link', {
      name: d.intake.newSellerAction,
      exact: true,
    })
    await open.click()
    await expect(name).toBeFocused()
    await expect(name).toBeInViewport()
    await expect(name).toHaveValue('')
    await expect(page.getByLabel(d.intake.email, { exact: true })).toHaveValue(
      '',
    )
    await expect(page.getByLabel(d.intake.phone, { exact: true })).toHaveValue(
      '',
    )
    await expect(page.locator('.intake-seller-results')).toHaveCount(0)
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: testInfo.outputPath(`registration-${width}.png`),
        fullPage: true,
        caret: 'initial',
      })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.keyboard.type('Synthetic new seller')
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(
      page.locator('.intake-registration-step').getByRole('alert'),
    ).toHaveText(d.intake.contactHint)
    await page
      .getByLabel(d.intake.email, { exact: true })
      .fill('new@example.test')
    await page.getByLabel(d.intake.phone, { exact: true }).fill('0701234567')
    await page
      .getByLabel(d.sellerDetails.business.type, { exact: true })
      .selectOption('business')
    await page
      .getByLabel(d.sellerDetails.business.companyName, { exact: true })
      .fill('Discarded synthetic company')
    await expect(name).not.toBeFocused()
    await page.getByRole('button', { name: d.cancel, exact: true }).click()
    await expect(name).toHaveCount(0)
    await expect(page.locator('#seller-search')).toBeFocused()
    await open.focus()
    await page.keyboard.press('Enter')
    await expect(name).toBeFocused()
    await expect(name).toHaveValue('')
    await expect(
      page.getByLabel(d.sellerDetails.business.type, { exact: true }),
    ).toHaveValue('private')
    await expect(
      page.locator('.intake-registration-step').getByRole('alert'),
    ).toHaveCount(0)
    await expect(page.getByLabel(d.intake.email, { exact: true })).toHaveValue(
      '',
    )
    await expect(page.getByLabel(d.intake.phone, { exact: true })).toHaveValue(
      '',
    )
    // Leaving and reopening through browser history also creates a blank form.
    await name.fill('Discard on Back')
    await page.goBack()
    await expect(name).toHaveCount(0)
    await page.goForward()
    await expect(name).toHaveValue('')
    await page.goto('/intake/quick')
    await page
      .getByRole('button', { name: d.quickIntake.newSeller, exact: true })
      .click()
    await expect(name).toBeFocused()
    await expect(name).toBeInViewport()
    await page.goto('/intake/quick')
    await page.goto('/intake#new-seller')
    await expect(name).toBeFocused()
    await page.goto(`/intake?seller=${f.seller}`)
    await page
      .getByRole('link', { name: d.intake.newSellerAction, exact: true })
      .click()
    await expect(page).toHaveURL('/intake#new-seller')
    await expect(name).toBeFocused()
    await expect(page.locator('.intake-registration-step')).toHaveCount(1)
  } finally {
    await f.close()
  }
})
