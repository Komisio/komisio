import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const status of [409, 500]) {
  test(`registration tab exposes a ${status} response after switching away`, async ({
    page,
  }) => {
    const email = `registration-feedback-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.goto('/settings?tab=vocabulary#vocabulary-registration')
      const tab = page
        .getByRole('tab')
        .filter({ hasText: d.registration.title })
      await page
        .getByText(d.registration.titleBuilder.customize, { exact: true })
        .click()
      const template = page.getByLabel(d.registration.titleBuilder.before, {
        exact: true,
      })
      const original = await template.inputValue()
      await template.fill('Synthetic draft')
      await expect(tab).toHaveAttribute(
        'aria-label',
        `${d.registration.title} — ${d.registration.unsaved}`,
      )
      await template.fill(original)
      await expect(tab).not.toHaveAttribute('aria-label')
      await template.fill('Synthetic draft')
      let respond!: () => void
      const gate = new Promise<void>((resolve) => {
        respond = resolve
      })
      await page.route('**/api/registration', async (route) => {
        await gate
        await route.fulfill({
          status,
          json: { error: 'Synthetic save failure' },
        })
      })
      await page
        .getByRole('button', { name: d.registration.save, exact: true })
        .click()
      await expect(tab).toHaveAttribute(
        'aria-label',
        `${d.registration.title} — ${d.registration.saving}`,
      )
      await page
        .getByRole('tab', { name: d.vocabularySettings.types, exact: true })
        .click()
      respond()
      const message =
        status === 409 ? d.registration.changed : d.registration.uncertain
      await expect(tab).toHaveAttribute('aria-selected', 'false')
      await expect(tab).toHaveAttribute(
        'aria-label',
        `${d.registration.title} — ${message}`,
      )
      const announcement = page.getByRole('status', {
        name: d.registration.title,
        exact: true,
      })
      await expect(announcement).toHaveText(
        `${d.registration.title}: ${message}`,
      )
      // The live region must remain outside the hidden tab panel.
      await expect(announcement).toBeVisible()
      await tab.click()
      await expect(template).toHaveValue('Synthetic draft')
      const retry = page.getByRole('button', {
        name: d.registration.retry,
        exact: true,
      })
      if (status === 409) {
        await expect(retry).toBeDisabled()
      } else {
        await page.unroute('**/api/registration')
        await retry.click()
        await expect(announcement).toHaveText(
          `${d.registration.title}: ${d.registration.saved}`,
        )
        await expect(tab).not.toHaveAttribute('aria-label')
      }
    } finally {
      await f.close()
    }
  })
}

test('readonly members can view registration settings but cannot edit or save', async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `registration-owner-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const readerEmail = `registration-reader-${randomUUID()}@example.test`
    const reader = await browser.newContext({
      baseURL,
    })
    try {
      const readerPage = await reader.newPage()
      await register(readerPage, readerEmail, `K!${randomUUID()}`)
      await f.db.query(
        "insert into tenant_members(tenant_id,user_id,role) select $1,id,'readonly' from auth.users where email=$2",
        [f.tenant, readerEmail],
      )
      await readerPage.goto('/settings?tab=vocabulary#vocabulary-registration')
      const panel = readerPage.getByRole('tabpanel', {
        name: d.registration.title,
        exact: true,
      })
      await expect(panel).toBeVisible()
      await expect(
        panel.getByRole('combobox', {
          name: d.registration.titleBuilder.add,
          exact: true,
        }),
      ).toBeDisabled()
      await expect(
        panel.getByLabel(d.registration.descriptionRequired, { exact: true }),
      ).toBeDisabled()
      await expect(panel.locator('input:enabled')).toHaveCount(0)
      await expect(
        panel.getByRole('button', { name: d.registration.save, exact: true }),
      ).toHaveCount(0)
    } finally {
      await reader.close()
    }
  } finally {
    await f.close()
  }
})
