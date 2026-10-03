import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelLeave(page: Page, target: Locator) {
  const prompt = page.waitForEvent('dialog')
  const click = target.click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

for (const withStore of [false, true])
  test(`account draft warns before leaving or mobile sign-out (${withStore ? 'store' : 'no store'})`, async ({
    page,
  }) => {
    const email = `account-draft-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = withStore ? await p2Fixture(email) : null
    try {
      if (f) await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/account')
      const name = page.locator('#profile-name')
      const language = page.locator('#profile-language')
      const initialName = await name.inputValue()
      const initialLanguage = await language.inputValue()
      const next = page.getByRole('link', {
        name: withStore ? d.newTenant : d.createTenant,
        exact: true,
      })
      await name.fill('Synthetic unsaved account')
      await language.selectOption('en')
      await cancelLeave(page, next)
      let signouts = 0
      page.on('request', (request) => {
        if (request.url().includes('/auth/v1/logout')) signouts++
      })
      await cancelLeave(
        page,
        page.getByRole('button', { name: d.logout, exact: true }),
      )
      expect(signouts).toBe(0)
      await expect(name).toHaveValue('Synthetic unsaved account')
      await expect(language).toHaveValue('en')
      await name.fill(initialName)
      await language.selectOption(initialLanguage)
      let warnings = 0
      page.on('dialog', async (dialog) => {
        warnings++
        await dialog.dismiss()
      })
      await next.click()
      await expect(page).toHaveURL('/onboarding')
      expect(warnings).toBe(0)
    } finally {
      if (f) await f.close()
    }
  })

test('a confirmed account save releases the draft warning and defines the new baseline', async ({
  page,
}) => {
  const email = `account-baseline-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/account')
    const form = page
      .locator('form')
      .filter({ has: page.locator('#profile-name') })
    const name = form.locator('#profile-name')
    await name.fill('Synthetic confirmed account')
    await form.getByRole('button', { name: d.save, exact: true }).click()
    await expect(form.locator('.notice-success')).toHaveText(d.saved)
    await expect(page.locator('.account-label').first()).toHaveText(
      'Synthetic confirmed account',
    )
    await name.fill('Later draft')
    const other = page.locator('.sidebar a[href="/intake/items"]')
    await cancelLeave(page, other)
    await name.fill('Synthetic confirmed account')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await other.click()
    await expect(page).toHaveURL('/intake/items')
    expect(warnings).toBe(0)
    expect(
      (
        await f.db.query(
          'select display_name from user_profiles where user_id=$1',
          [f.actor],
        )
      ).rows[0].display_name,
    ).toBe('Synthetic confirmed account')
  } finally {
    await f.close()
  }
})

test('account fields wait for their handlers before accepting edits', async ({
  page,
}) => {
  const email = `account-ready-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  let release!: () => void
  const scripts = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.goto('/account', { waitUntil: 'commit' })
    for (const field of [
      '#profile-name',
      '#profile-language',
      '#new-password',
    ]) {
      await expect(page.locator(field)).toBeVisible()
      await expect(page.locator(field)).toBeDisabled()
    }
    await expect(
      page.getByRole('button', { name: d.save, exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: d.savePassword, exact: true }),
    ).toBeDisabled()
    release()
    for (const field of ['#profile-name', '#profile-language', '#new-password'])
      await expect(page.locator(field)).toBeEnabled()
    await page.locator('#profile-name').fill('Synthetic ready draft')
    await cancelLeave(
      page,
      page.getByRole('link', { name: d.createTenant, exact: true }),
    )
    await page.locator('#profile-name').fill('')
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await page.getByRole('link', { name: d.createTenant, exact: true }).click()
    await expect(page).toHaveURL('/onboarding')
    expect(warnings).toBe(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
