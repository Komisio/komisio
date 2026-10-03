import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const kind of ['profile', 'terms'] as const) {
  test(`stale seller ${kind} reloads current data without leaving its tab`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    const email = `seller-recovery-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      const tab = kind === 'profile' ? 'details' : 'terms'
      const path = `/intake/sellers/${f.seller}?itemsPage=1#seller-${tab}`
      await page.goto(path)
      const panel = page.locator(`#seller-${tab}`)
      const editor =
        kind === 'profile' ? d.sellerDetails.edit : d.sellerProfile.editTerms
      await panel.getByText(editor, { exact: true }).click()
      const field = panel.locator(
        kind === 'profile' ? '#seller-profile-name' : '#terms-notes',
      )
      await field.fill('Unsubmitted synthetic change')
      if (kind === 'terms') await panel.getByRole('checkbox').check()
      const latest = 'Latest concurrent synthetic change'
      await f.asActor(f.actor, async () => {
        if (kind === 'profile') {
          const seller = (
            await f.db.query(
              'select name,email,phone from sellers where tenant_id=$1 and id=$2',
              [f.tenant, f.seller],
            )
          ).rows[0]
          await f.db.query('select save_seller_profile($1,$2,$3,0,$4::jsonb)', [
            f.tenant,
            randomUUID(),
            f.seller,
            JSON.stringify({
              ...seller,
              name: latest,
              addressLine1: '',
              addressLine2: '',
              postalCode: '',
              city: '',
              country: '',
              language: '',
              notes: '',
            }),
          ])
        } else {
          await f.db.query(
            'select publish_seller_terms($1,$2,$3,null,null,null,$4)',
            [f.tenant, randomUUID(), f.seller, latest],
          )
        }
      })
      const action =
        kind === 'profile' ? 'saveSellerProfile' : 'publishSellerTerms'
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake') &&
          r.request().postDataJSON()?.action === action,
      )
      await panel
        .getByRole('button', {
          name:
            kind === 'profile' ? d.sellerDetails.save : d.sellerTerms.publish,
          exact: true,
        })
        .click()
      expect((await response).status()).toBe(409)
      await expect(panel.getByRole('alert')).toHaveText(d.intake.recordChanged)
      await expect(field).toBeDisabled()
      const reload = panel.getByText(d.intake.reload, { exact: true })
      await expect(reload).toBeVisible()
      if (kind === 'profile')
        page.once('dialog', async (dialog) => {
          expect(dialog.type()).toBe('beforeunload')
          await dialog.accept()
        })
      await reload.click()
      await expect(page).toHaveURL(new RegExp(`itemsPage=1#seller-${tab}$`))
      await expect(
        page.getByRole('tab', { name: d.sellerWorkspace[tab], exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await panel.getByText(editor, { exact: true }).click()
      await expect(field).toBeEnabled()
      await expect(field).toHaveValue(latest)
      await expect(panel.getByRole('alert')).toHaveCount(0)
      // Reloading must not silently submit or overwrite the concurrent version.
      const count = await f.db.query(
        kind === 'profile'
          ? 'select count(*)::int n from seller_profile_versions where tenant_id=$1 and seller_id=$2 and revision>0'
          : 'select count(*)::int n from seller_terms_versions where tenant_id=$1 and seller_id=$2',
        [f.tenant, f.seller],
      )
      expect(count.rows[0].n).toBe(1)
    } finally {
      await f.close()
    }
  })
}
