import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('owner opts a store into the mobile directory and can hide it again', async ({
  page,
}) => {
  const email = `app-visibility-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=profile')
    const section = page.getByRole('region', { name: d.storeProfile.appTitle })
    const checkbox = section.getByRole('checkbox', {
      name: d.storeProfile.appLabel,
    })
    await expect(checkbox).not.toBeChecked()
    for (const visible of [true, false]) {
      await checkbox.setChecked(visible)
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake') &&
          r.request().postDataJSON()?.action === 'setStoreAppVisibility',
      )
      await section
        .getByRole('button', { name: d.storeProfile.appSave })
        .click()
      expect((await saved).status()).toBe(200)
      await expect(section.getByRole('status')).toHaveText(
        d.storeProfile.appSaved,
      )
      await page.reload()
      await expect(checkbox).toBeChecked({ checked: visible })
      await f.db.query('begin')
      try {
        await f.db.query('set local role anon')
        const result = await f.db.query('select public_app_stores() stores')
        expect(
          result.rows[0].stores.some((s: { id: string }) => s.id === f.tenant),
        ).toBe(visible)
      } finally {
        await f.db.query('rollback')
      }
    }
  } finally {
    await f.close()
  }
})
