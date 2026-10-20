import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'

test('member directory renders a paired print device without a profile or email', async ({
  page,
}) => {
  const email = `members-device-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const printer = randomUUID()
    const code = await f.asActor(f.actor, async () => {
      await f.db.query("select save_profile('Synthetic owner','sv')")
      await f.db.query(
        "select register_printer($1,$2,'Synthetic counter','tcp','192.0.2.1:9100','ZD420',203)",
        [f.tenant, printer],
      )
      return (
        await f.db.query('select create_print_pairing_code($1,$2) pairing', [
          f.tenant,
          printer,
        ])
      ).rows[0].pairing.code
    })
    const device = randomUUID()
    await f.db.query(
      'insert into auth.users(id,is_anonymous) values($1,true)',
      [device],
    )
    await f.asActor(device, async () => {
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: device,
          role: 'authenticated',
          is_anonymous: true,
        }),
      ])
      await f.db.query(
        "select pair_print_device($1,'Synthetic device','1.0.0')",
        [code],
      )
    })
    // Exercise the real RPC shape, rather than manufacturing a UI-only null fixture.
    await f.asActor(f.actor, async () => {
      const members = await f.db.query('select * from list_members($1)', [
        f.tenant,
      ])
      expect(
        members.rows.find((row: { user_id: string }) => row.user_id === device),
      ).toMatchObject({ display_name: null, email: null, role: 'device' })
    })
    let writes = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/api/platform')
      )
        writes++
    })
    for (const locale of ['sv', 'en'] as const) {
      const d: Dictionary = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/members')
        const directory = page.getByRole('table', {
          name: d.members,
          exact: true,
        })
        await expect(directory.getByRole('row')).toHaveCount(3)
        await expect(
          directory.getByText('Synthetic owner', { exact: false }),
        ).toBeVisible()
        const deviceRow = directory
          .getByRole('row')
          .filter({ hasText: d.roles.device })
        await expect(deviceRow.locator('strong')).toHaveText(d.roles.device)
        await expect(deviceRow.getByRole('combobox')).toHaveCount(0)
        await expect(deviceRow.getByRole('button')).toHaveCount(0)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
      }
    }
    expect(writes).toBe(0)
    await page.screenshot({
      path: 'private/members-device.png',
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
