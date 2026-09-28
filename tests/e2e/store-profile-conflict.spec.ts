import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Two sessions edit the store profile. The second one, still holding the page
// read before the first published, must not overwrite that version and must
// be able to reload the current one from where they are.
test('a stale store profile reloads the current version on the profile tab without writing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const email = `store-profile-conflict-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=profile')
    const form = page.getByRole('region', {
      name: d.storeProfile.title,
      exact: true,
    })
    const city = form.locator('#profile-city')
    await expect(city).toBeEnabled()
    await city.fill('Unsubmitted synthetic city')
    // A separate session publishes the first version after this page was read.
    const latest = 'Latest concurrent synthetic city'
    await f.asActor(f.actor, async () => {
      await f.db.query('select publish_store_profile($1,$2,null,$3::jsonb)', [
        f.tenant,
        randomUUID(),
        JSON.stringify({
          address: {
            street: 'Storgatan 1',
            postalCode: '111 22',
            city: latest,
          },
          contact: {
            email: 'hej@example.test',
            phone: '08-123',
            website: 'https://example.test',
          },
          openingHours: [{ day: 'mon', opens: '10:00', closes: '18:00' }],
          accepts: 'Clean, whole garments in season.',
          concept: 'Second hand for grown-ups.',
          language: 'sv',
        }),
      ])
    })
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'publishStoreProfile',
    )
    await form
      .getByRole('button', { name: d.storeProfile.publish, exact: true })
      .click()
    const reply = await response
    expect(reply.status()).toBe(409)
    expect((await reply.json()).error).toBe('PROFILE_CHANGED')
    await expect(form.getByRole('alert').first()).toHaveText(
      d.intake.recordChanged,
    )
    await expect(
      form.getByRole('button', { name: d.storeProfile.publish, exact: true }),
    ).toBeDisabled()
    // Check the field after the busy label is gone, not only during the request.
    await expect(city).toBeDisabled()
    await form
      .locator('form')
      .evaluate((node) => (node as HTMLFormElement).requestSubmit())
    await expect(form.getByRole('alert')).toHaveText(d.intake.recordChanged)
    // A way forward from the same place: reload, keeping the profile tab.
    const reload = form.getByRole('button', {
      name: d.intake.reload,
      exact: true,
    })
    await expect(reload).toBeVisible()
    await reload.click()
    await expect(page).toHaveURL(/\/settings\?tab=profile$/)
    await expect(form.locator('#profile-city')).toHaveValue(latest)
    await expect(form.locator('#profile-city')).toBeEnabled()
    await expect(form.getByRole('alert')).toHaveCount(0)
    await expect(form).toContainText(`${d.storeProfile.version} 1`)
    // The stale submission and the reload wrote nothing.
    const versions = await f.db.query(
      'select count(*)::int n from store_profile_versions where tenant_id=$1',
      [f.tenant],
    )
    expect(versions.rows[0].n).toBe(1)
  } finally {
    await f.close()
  }
})
