import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Two sessions of the same owner edit the account map (a separate database
// session publishes; this is a concurrent-version conflict, not a two-role
// authorization test). The browser session read the page before the other
// published, so its stale publication is refused by the engine; the client
// must then offer a way to the current version without writing anything.
// No export, day close, voucher, provider or Fortnox call is involved.
test('a stale account map reloads the current version in place without writing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const email = `account-map-conflict-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const form = page.getByRole('region', {
      name: d.accounting.mapHeading,
      exact: true,
    })
    const gross = form.locator('#account\\:grossOre')
    await expect(gross).toBeEnabled()
    await expect(form).toContainText(d.accounting.noMap)
    await gross.fill('1910')
    // The other session publishes the first map after this page was read.
    await f.asActor(f.actor, async () => {
      await f.db.query('select publish_accounting_map($1,$2,null,$3::jsonb)', [
        f.tenant,
        randomUUID(),
        JSON.stringify({ grossOre: { account: '1930', side: 'debit' } }),
      ])
    })
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'publishAccountingMap',
    )
    await form
      .getByRole('button', { name: d.accounting.publishMap, exact: true })
      .click()
    const reply = await response
    expect(reply.status()).toBe(409)
    expect((await reply.json()).error).toBe('MAP_CHANGED')
    await expect(form.getByRole('alert')).toHaveText(d.intake.recordChanged)
    await expect(gross).toBeDisabled()
    await expect(
      form.getByRole('button', { name: d.accounting.publishMap, exact: true }),
    ).toBeDisabled()
    // A way forward from the same place, keeping the settings view.
    const reload = form.getByRole('button', {
      name: d.intake.reload,
      exact: true,
    })
    await expect(reload).toBeVisible()
    await reload.click()
    await expect(page).toHaveURL(/\/intake\/accounting\?view=settings$/)
    await expect(form.locator('#account\\:grossOre')).toHaveValue('1930')
    await expect(form.locator('#account\\:grossOre')).toBeEnabled()
    await expect(form).toContainText(`${d.accounting.mapVersion} 1`)
    await expect(form.getByRole('alert')).toHaveCount(0)
    // Neither the stale submission nor the reload wrote a version.
    const versions = await f.db.query(
      'select count(*)::int n, max(version) v from accounting_maps where tenant_id=$1',
      [f.tenant],
    )
    expect(versions.rows[0]).toEqual({ n: 1, v: 1 })
  } finally {
    await f.close()
  }
})
