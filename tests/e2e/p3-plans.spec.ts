import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Plans and trial through the browser: billing switched on for the test,
// the trial banner, manual activation on the host page, and the read-only
// state; billing is switched off again at the end.
test('trial banner, host activation and read-only state', async ({ page }) => {
  const email = `p3-plans-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const plan = async (sql: string) => {
    await f.db.query('begin')
    await f.db.query(
      "select set_config('komisio.plan_transition','engine',true)",
    )
    await f.db.query(sql, [f.tenant])
    await f.db.query('commit')
  }
  try {
    await f.commit()
    // Billing on: the existing store stays active on a manual plan; the owner becomes a host.
    await f.db.query('select komisio_private.enable_billing($1)', [f.actor])
    await page.goto('/settings')
    const panel = page.getByRole('region', {
      name: d.plans.heading,
      exact: true,
    })
    await expect(
      panel.getByText(d.plans.states.active, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: d.hostLink, exact: true }).first(),
    ).toBeVisible()

    // A trial ending in three days shows the banner on every page.
    await plan(
      "update tenant_plans set state='trial', provider='none', trial_ends_at=now()+interval '3 days' where tenant_id=$1",
    )
    await page.goto('/')
    await expect(
      page.getByText(d.plans.trialEndingSoon.replace('{days}', '3'), {
        exact: false,
      }),
    ).toBeVisible()

    // The host activates the store by hand with a reason.
    await page.goto('/host')
    const host = page.getByRole('region', {
      name: d.plans.hostTitle,
      exact: true,
    })
    const slug = (
      await f.db.query('select slug from tenants where id=$1', [f.tenant])
    ).rows[0].slug as string
    const row = host.getByRole('row', { name: new RegExp(slug) })
    await expect(
      row.getByText(d.plans.states.trial, { exact: true }),
    ).toBeVisible()
    // Activity next to the plan: one member, one seller, nothing sold.
    await expect(row.getByRole('cell').nth(5)).toHaveText('1')
    await expect(row.getByRole('cell').nth(6)).toHaveText('1')
    await expect(row.getByRole('cell').nth(8)).toHaveText('0')
    await row
      .getByRole('button', { name: d.plans.activate, exact: true })
      .click()
    await page.getByLabel(d.plans.reason, { exact: true }).fill('Pilot store')
    await page
      .getByRole('button', { name: d.plans.confirmActivate, exact: true })
      .click()
    await expect(
      page.getByText(d.plans.activated.replace('{name}', 'P2 browser store'), {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      row.getByText(d.plans.states.active, { exact: true }),
    ).toBeVisible()
    const events = (
      await f.db.query(
        'select kind from tenant_plan_events where tenant_id=$1 order by occurred_at',
        [f.tenant],
      )
    ).rows.map((r: { kind: string }) => r.kind)
    expect(events.at(-1)).toBe('activated')

    // Read-only: the banner says so and the engine refuses a new fact.
    await plan("update tenant_plans set state='read_only' where tenant_id=$1")
    await page.goto('/')
    await expect(
      page.getByRole('alert').filter({ hasText: d.plans.readOnly }),
    ).toBeVisible()
    await expect(
      f.asActor(f.actor, () =>
        f.db.query(
          "select register_seller($1,$2,'Late seller','late@plans.test','')",
          [f.tenant, randomUUID()],
        ),
      ),
    ).rejects.toThrow(/PLAN_READ_ONLY/)
  } finally {
    await f.db
      .query('update platform_settings set billing_enabled=false')
      .catch(() => undefined)
    await f.db
      .query('delete from platform_hosts where user_id=$1', [f.actor])
      .catch(() => undefined)
    await f.close()
  }
})
