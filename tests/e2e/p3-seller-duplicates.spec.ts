import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Registering a seller whose contact details already exist shows the
// existing seller first; registering anyway is an explicit second step.
test('the counter is warned about an existing seller before a second record', async ({
  page,
}) => {
  const email = `p3-dup-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const existing = (
      await f.db.query('select email from sellers where id=$1', [f.seller])
    ).rows[0].email as string
    await page.goto('/intake')
    await expect(
      page.getByRole('heading', { name: d.intake.title, exact: true }),
    ).toBeVisible()
    await expect(page.locator('.intake-notice')).toHaveCount(0)
    await expect(
      page
        .locator('.intake-paths')
        .getByRole('link', { name: new RegExp(d.quickIntake.title) }),
    ).toBeVisible()
    await page.screenshot({
      path: 'private/intake-overview-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/intake-overview-mobile.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    const form = page
      .getByRole('heading', { name: d.intake.newSeller })
      .locator('..')
    await form.getByLabel(d.intake.name).fill('Another Name')
    await form.getByLabel(d.intake.email).fill(existing.toUpperCase())
    await form
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    const warning = form.getByRole('alert')
    await expect(warning).toContainText(d.intake.possibleDuplicates)
    await expect(
      warning.getByRole('link', { name: 'Synthetic P2 seller', exact: true }),
    ).toHaveAttribute('href', `/intake?seller=${f.seller}#new-seller`)
    await expect(warning).toContainText(d.intake.matchEmail)
    await form
      .getByRole('button', { name: d.intake.registerAnyway, exact: true })
      .click()
    await expect(page).toHaveURL(/\/intake\?seller=[0-9a-f-]{36}#new-seller$/)
    expect(page.url()).not.toContain(f.seller)
    await expect(page.getByText('Another Name').first()).toBeVisible()
  } finally {
    await f.close()
  }
})
