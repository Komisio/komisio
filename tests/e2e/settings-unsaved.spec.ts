import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelLeave(page: Page, link: Locator) {
  const prompt = page.waitForEvent('dialog')
  const click = link.click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

test('profile edits survive cancelled tab, language and reload navigation; restoring values clears the warning', async ({
  page,
}) => {
  const email = `profile-unsaved-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=profile')
    const city = page.locator('#profile-city')
    await city.fill('Synthetic unsaved city')
    const other = page.locator('.view-tab[href="/settings"]')
    await cancelLeave(page, other)
    await expect(city).toHaveValue('Synthetic unsaved city')
    const picker = page.locator('.language-picker:visible').first()
    await picker.locator('summary').click()
    await cancelLeave(
      page,
      picker.getByRole('button', { name: 'English', exact: true }),
    )
    await picker.locator('summary').click()
    const prompt = page.waitForEvent('dialog')
    await page.evaluate(() => setTimeout(() => location.reload(), 0))
    const dialog = await prompt
    expect(dialog.type()).toBe('beforeunload')
    await dialog.dismiss()
    await expect(city).toHaveValue('Synthetic unsaved city')
    await city.fill('')
    // Conditional time fields are excluded again after deselecting the day.
    await page
      .getByRole('checkbox', { name: d.storeProfile.days.mon, exact: true })
      .check()
    await page.locator('#opens-mon').fill('09:30')
    await cancelLeave(page, other)
    await page
      .getByRole('checkbox', { name: d.storeProfile.days.mon, exact: true })
      .uncheck()
    let unexpected = 0
    page.on('dialog', async (dialog) => {
      unexpected++
      await dialog.dismiss()
    })
    await other.click()
    await expect(page).toHaveURL('/settings')
    expect(unexpected).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from store_profile_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('policy step edits warn before leaving and a confirmed publication releases the warning', async ({
  page,
}) => {
  const email = `policy-unsaved-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings')
    await page
      .getByRole('link', { name: d.storePolicy.sectionPeriod, exact: true })
      .click()
    const steps = page.getByRole('group', {
      name: d.storePolicy.markdownSteps,
      exact: true,
    })
    const count = await steps
      .getByRole('button', { name: d.storePolicy.remove, exact: true })
      .count()
    await steps
      .getByRole('button', { name: d.storePolicy.add, exact: true })
      .click()
    const other = page.locator('.view-tab[href="/settings?tab=profile"]')
    await cancelLeave(page, other)
    await expect(
      steps.getByRole('button', { name: d.storePolicy.remove, exact: true }),
    ).toHaveCount(count + 1)
    await steps
      .getByRole('button', { name: d.storePolicy.remove, exact: true })
      .last()
      .click()
    await other.click()
    await expect(page).toHaveURL('/settings?tab=profile')
    await page.locator('.view-tab[href="/settings"]').click()
    await page
      .getByRole('link', { name: d.storePolicy.sectionEconomy, exact: true })
      .click()
    await page.locator('#policy-commissionRatePercent').fill('55')
    await cancelLeave(page, other)
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    await expect(page.locator('.policy-version')).toContainText('2')
    let unexpected = 0
    page.on('dialog', async (dialog) => {
      unexpected++
      await dialog.dismiss()
    })
    await other.click()
    await expect(page).toHaveURL('/settings?tab=profile')
    expect(unexpected).toBe(0)
  } finally {
    await f.close()
  }
})

test('an unanswered profile publication retains its warning and retry even without changed fields', async ({
  page,
}) => {
  const email = `profile-pending-warning-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=profile')
    await page.route(
      '**/api/intake',
      async (route) => {
        if (route.request().postDataJSON()?.action !== 'publishStoreProfile')
          return route.continue()
        expect((await route.fetch()).status()).toBe(200)
        await route.abort('failed')
      },
      { times: 1 },
    )
    await page
      .getByRole('button', { name: d.storeProfile.publish, exact: true })
      .click()
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      d.intake.failed,
    )
    const other = page.locator('.view-tab[href="/settings"]')
    await cancelLeave(page, other)
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.storeProfile.title, exact: true }),
    ).toContainText(`${d.storeProfile.version} 1`)
    await other.click()
    await expect(page).toHaveURL('/settings')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from store_profile_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
