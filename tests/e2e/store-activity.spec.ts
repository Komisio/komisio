import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('activity filters, stable pages and role restriction', async ({
  page,
}, testInfo) => {
  const email = `activity-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    // Synthetic immutable observations, scoped to this local fixture only.
    await f.db.query(
      "insert into access_events(tenant_id,actor_id,action,occurred_at,detail) select $1,$2,'tenant.renamed','2025-10-22T22:30:00Z','{\"secret\":\"PRIVATE_PAYLOAD\"}' from generate_series(1,30)",
      [f.tenant, f.actor],
    )
    await f.db.query(
      "insert into access_events(tenant_id,actor_id,action,occurred_at,target_id) values($1,$2,'future.new_action','2025-10-22T22:31:00Z','01234567-89ab-cdef-0123-456789abcdef')",
      [f.tenant, f.actor],
    )
    await page.goto('/settings/activity')
    await expect(
      page.getByRole('heading', { name: d.activity.title }),
    ).toBeVisible()
    await page.getByLabel(d.activity.from, { exact: true }).fill('2025-10-23')
    await page.getByLabel(d.activity.to, { exact: true }).fill('2025-10-23')
    await page
      .getByRole('combobox', { name: d.activity.actor, exact: true })
      .fill(f.actor)
    await page.getByRole('button', { name: d.activity.apply }).click()
    await expect(page).toHaveURL(/from=2025-10-23/)
    await expect(page.locator('.activity-list li')).toHaveCount(25)
    await expect(page.locator('.activity-list li').first()).toContainText(
      d.activity.unknown,
    )
    await expect(
      page
        .locator('.activity-list')
        .getByText(d.activity.unknown, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('future.new_action', { exact: true }),
    ).not.toBeVisible()
    await page.locator('.activity-list li').first().locator('summary').click()
    await expect(
      page.getByText('future.new_action', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('01234567-89ab-cdef-0123-456789abcdef', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('PRIVATE_PAYLOAD')).toHaveCount(0)
    await expect(page.locator('.activity-list time').first()).toContainText(
      '00:31',
    )
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page.locator('.activity-list li')).toHaveCount(6)
    await expect(page).toHaveURL(/page=2/)
    await page
      .getByLabel(d.activity.action, { exact: true })
      .selectOption('tenant.renamed')
    await page.getByRole('button', { name: d.activity.apply }).click()
    await expect(page).not.toHaveURL(/page=2/)
    await expect(page.locator('.activity-list li')).toHaveCount(25)
    await page.setViewportSize({ width: 375, height: 850 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('activity-mobile.png'),
      fullPage: true,
    })
    await page.getByLabel(d.activity.from, { exact: true }).fill('2025-10-24')
    await page.getByLabel(d.activity.to, { exact: true }).fill('2025-10-24')
    await page.getByRole('button', { name: d.activity.apply }).click()
    await expect(page.getByText(d.activity.empty)).toBeVisible()
    // Add another owner before changing this actor, preserving the last-owner invariant.
    const other = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [other, `other-${randomUUID()}@example.test`],
    )
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
      [f.tenant, other],
    )
    await f.db.query(
      "update tenant_members set role='staff' where tenant_id=$1 and user_id=$2",
      [f.tenant, f.actor],
    )
    await page.reload()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      d.errors.FORBIDDEN,
    )
    await page.goto('/menu')
    await expect(
      page.getByRole('link', { name: d.activity.title, exact: true }),
    ).toHaveCount(0)
  } finally {
    await f.close()
  }
})
