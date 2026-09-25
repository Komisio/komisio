import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('quick reception turns a garment into an accepted item on one screen', async ({
  page,
}) => {
  const email = `quick-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    const back = page.locator('.intake-header').getByRole('link')
    await expect(back).toHaveCSS('text-decoration-line', 'underline')
    const newSeller = page.getByRole('link', {
      name: d.quickIntake.newSeller,
      exact: true,
    })
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      expect((await newSeller.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      const choice = page.getByRole('button', { name: /Synthetic P2 seller/ })
      expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await newSeller.focus()
    await expect(newSeller).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/intake#new-seller$/)
    await expect(page.locator('#new-seller')).toBeInViewport()
    await page.goto('/intake/quick')
    await page.screenshot({
      path: 'private/link-clarity-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: 'private/link-clarity-mobile.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page
      .getByLabel(d.quickIntake.searchSeller, { exact: true })
      .fill('Synthetic')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toHaveAttribute('required', '')
    await expect(
      page.getByLabel(d.quickIntake.price, { exact: true }),
    ).toHaveAttribute('required', '')
    await expect(
      page.getByLabel(d.quickIntake.category, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByLabel(d.quickIntake.itemType, { exact: true }),
    ).not.toHaveAttribute('required')
    await expect(
      page.getByText(d.quickIntake.addPhoto, { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: 'private/quick-design-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
      page.getByRole('button', { name: d.quickIntake.submit, exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/quick-design-mobile.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Snabb jacka')
    const typeInput = page.getByLabel(d.quickIntake.itemType, { exact: true })
    const typeLabel = await page
      .locator('#quick-item-types option')
      .first()
      .getAttribute('value')
    expect(typeLabel).toBeTruthy()
    await typeInput.fill(typeLabel!)
    await typeInput.press('Tab')
    await expect(typeInput).toHaveValue(typeLabel!)
    await expect(
      page.getByLabel(d.quickIntake.category, { exact: true }),
    ).toHaveCount(0)
    await typeInput.fill('')
    await typeInput.press('Tab')
    await expect(typeInput).toHaveValue('')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('250')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(/I-[0-9A-F]{8}/)
    const items = (
      await f.db.query(
        'select count(*)::int as n from items where tenant_id=$1 and origin_kind=$2',
        [f.tenant, 'reception_review'],
      )
    ).rows[0].n
    expect(items).toBe(1)
    // The items list and the item page read the derived ids without complaint.
    await page.goto('/intake/items')
    await expect(page.getByText('Snabb jacka').first()).toBeVisible()
    await page
      .getByRole('link', { name: /Snabb jacka/ })
      .first()
      .click()
    await expect(page.getByText('250.00 SEK').first()).toBeVisible()
    await page.goto('/intake/quick')
    await page
      .getByLabel(d.quickIntake.searchSeller, { exact: true })
      .fill('Synthetic')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Snabb kappa')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('400')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(/I-[0-9A-F]{8}/)
    await page
      .getByRole('button', { name: d.quickIntake.next, exact: true })
      .click()
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toHaveValue('')
  } finally {
    await f.close()
  }
})
