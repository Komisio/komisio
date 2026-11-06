import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }

for (const locale of ['sv', 'en'] as const) {
  test(`host support keeps real identity and read-only store access in ${locale}`, async ({
    page,
  }, testInfo) => {
    const d = locale === 'sv' ? sv : en
    const t = d.hostSupport
    const email = `host-support-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const item = await f.item('Support test jacket')
      await f.commit()
      const owner = randomUUID()
      // Trusted local fixtures move ownership before support starts. The host
      // has no ordinary membership in the store under investigation.
      await f.db.query(
        'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
        [owner, `support-owner-${owner}@example.test`],
      )
      await f.db.query(
        "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
        [f.tenant, owner],
      )
      await f.db.query(
        'delete from tenant_members where tenant_id=$1 and user_id=$2',
        [f.tenant, f.actor],
      )
      await f.db.query(
        "insert into platform_hosts(user_id,kind) values($1,'person')",
        [f.actor],
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      await page.setViewportSize({
        width: locale === 'en' ? 390 : 1280,
        height: 900,
      })
      await page.goto('/host')
      await page
        .getByRole('searchbox', { name: d.plans.searchStores })
        .fill('P2 browser store')
      // Other test runs use the same visible store name; the unique slug is exact.
      const slug = (
        await f.db.query('select slug from tenants where id=$1', [f.tenant])
      ).rows[0].slug
      await page
        .getByRole('searchbox', { name: d.plans.searchStores })
        .fill(slug)
      await page
        .getByRole('button', { name: `P2 browser store ${slug}` })
        .click()
      await page.getByRole('button', { name: t.open, exact: true }).click()
      await expect(page.getByLabel(t.reason, { exact: true })).toBeFocused()
      await page
        .getByLabel(t.reason, { exact: true })
        .fill('Investigate synthetic seller')
      if (locale === 'en') {
        let lost = false
        let exitLost = false
        let first: unknown
        await page.route('**/api/host/support', async (route) => {
          const command = route.request().postDataJSON()
          if (command.action === 'end') {
            const response = await route.fetch()
            if (!exitLost) {
              exitLost = true
              await route.abort('connectionfailed')
            } else await route.fulfill({ response })
            return
          }
          if (first) expect(command).toEqual(first)
          else first = command
          const response = await route.fetch()
          if (!lost) {
            lost = true
            await route.abort('connectionfailed')
          } else await route.fulfill({ response })
        })
      }
      await page.getByRole('button', { name: t.start, exact: true }).click()
      if (locale === 'en') {
        await expect(
          page.getByRole('alert').filter({ hasText: t.uncertain }),
        ).toBeVisible()
        await expect(page.getByLabel(t.reason, { exact: true })).toBeDisabled()
        await page.getByRole('button', { name: t.retry, exact: true }).click()
      }
      await expect(page).toHaveURL(/\/intake\/sellers$/)
      const banner = page.getByRole('region', { name: t.mode, exact: true })
      await expect(banner).toContainText(t.readOnly)
      await expect(
        page.getByRole('combobox', { name: d.activeTenant }).first(),
      ).toBeDisabled()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true)
      await expect(
        page.getByText('Synthetic P2 seller', { exact: true }),
      ).toBeVisible()
      await page.goto(`/intake/sellers/${f.seller}`)
      await expect(banner).toBeVisible()
      await page.goto(`/intake/items/${item}`)
      await expect(
        page.getByText('Support test jacket', { exact: true }).first(),
      ).toBeVisible()
      await page.goto('/settings?tab=vocabulary#vocabulary-registration')
      await expect(banner).toBeVisible()
      await expect(
        page.getByRole('checkbox', {
          name: d.registration.descriptionRequired,
          exact: true,
        }),
      ).toBeDisabled()
      await expect(
        page.getByRole('button', { name: d.registration.save, exact: true }),
      ).toHaveCount(0)
      await page.screenshot({
        path: testInfo.outputPath(`support-${locale}.png`),
        fullPage: true,
      })
      const response = await page.request.post('/api/platform', {
        data: { action: 'rename', tenantId: f.tenant, name: 'Forbidden name' },
        headers: { Origin: new URL(page.url()).origin },
      })
      expect(response.status()).toBe(403)
      const visits = (
        await f.db.query(
          'select * from komisio_private.host_support_visits where user_id=$1',
          [f.actor],
        )
      ).rows
      expect(visits).toHaveLength(1)
      expect(visits[0].tenant_id).toBe(f.tenant)
      expect(visits[0].reason).toBe('Investigate synthetic seller')
      expect(
        (
          await f.db.query(
            'select count(*)::int n from tenant_members where user_id=$1',
            [f.actor],
          )
        ).rows[0].n,
      ).toBe(0)
      if (locale === 'en') {
        await f.db.query('delete from platform_hosts where user_id=$1', [
          f.actor,
        ])
        await page.reload()
        await expect(page).toHaveURL(/\/support(?:#.*)?$/)
        await expect(banner).toContainText(t.expired)
        // Restore for the host-list return; revocation was already enforced.
        await f.db.query(
          "insert into platform_hosts(user_id,kind) values($1,'person')",
          [f.actor],
        )
      }
      await banner.getByRole('button', { name: t.end, exact: true }).click()
      if (locale === 'en') {
        await expect(banner.getByRole('alert')).toHaveText(t.exitFailed)
        await banner.getByRole('button', { name: t.end, exact: true }).click()
      }
      await expect(page).toHaveURL(/\/host$/)
      await expect(
        page
          .getByRole('heading', { name: d.plans.hostTitle, exact: true })
          .first(),
      ).toBeVisible()
      expect(
        (
          await f.db.query(
            'select count(*)::int n from komisio_private.host_support_ends where visit_id=$1',
            [visits[0].id],
          )
        ).rows[0].n,
      ).toBe(1)
      await page.goto(`/intake/items/${item}`)
      await expect(page).toHaveURL(/\/onboarding$/)
    } finally {
      await f.close()
    }
  })
}
