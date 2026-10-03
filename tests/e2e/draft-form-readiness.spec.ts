import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const kind of [
  'printer',
  'store-profile',
  'reception',
  'quick-bag',
] as const)
  test(`${kind} draft waits for handlers and compares the first edit with its original value`, async ({
    page,
  }) => {
    const email = `draft-ready-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const session = randomUUID()
    let release!: () => void
    const scripts = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      if (kind === 'reception')
        await f.db.query('select create_reception_session($1,$2,$3)', [
          f.tenant,
          session,
          f.seller,
        ])
      let bag: string | undefined
      if (kind === 'quick-bag') {
        await f.item('Synthetic existing bag item')
        bag = (
          await f.db.query(
            'select id from bag_receipts where tenant_id=$1 limit 1',
            [f.tenant],
          )
        ).rows[0].id
      }
      await f.commit()
      const path =
        kind === 'printer'
          ? '/settings?tab=printing'
          : kind === 'store-profile'
            ? '/settings?tab=profile'
            : kind === 'quick-bag'
              ? `/intake/bags/${bag}/inspect?itemPage=1`
              : `/intake/reception/${session}`
      await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
        await scripts
        await route.continue()
      })
      await page.goto(path, { waitUntil: 'commit' })
      const field =
        kind === 'printer'
          ? page.locator('input[name="name"]').first()
          : page.locator(
              kind === 'store-profile'
                ? '#profile-street'
                : kind === 'quick-bag'
                  ? '#quick-description'
                  : '#garment-description',
            )
      await expect(field).toBeVisible()
      await expect(field).toBeDisabled()
      await field.focus()
      await expect(field).not.toBeFocused()
      const original = await field.inputValue()
      release()
      await expect(field).toBeEnabled()
      await field.fill('Synthetic first editable draft')
      let warnings = 0
      page.on('dialog', async (dialog) => {
        warnings++
        expect(dialog.message()).toBe(
          kind === 'quick-bag' ? d.quickIntake.leaveItem : d.leaveUnsaved,
        )
        await dialog.dismiss()
      })
      const link = page.locator('.sidebar a[href="/intake/items"]')
      await link.click()
      await expect.poll(() => warnings).toBe(1)
      await expect(field).toHaveValue('Synthetic first editable draft')
      await field.fill(original)
      await link.click()
      await expect(page).toHaveURL('/intake/items')
      expect(warnings).toBe(1)
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
      await f.close()
    }
  })
