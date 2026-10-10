import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('owner opts into automatic day closes, recovers an uncertain save and can stop preparation', async ({
  page,
}, testInfo) => {
  const email = `automatic-close-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const t = d.accounting.dayCloseAutomation
  try {
    const item = await f.item('Synthetic automatic close shirt')
    await f.db.query(
      "select record_sale($1,$2,'manual','day-close-browser',((now() at time zone 'Europe/Stockholm')::date-1)::timestamp at time zone 'Europe/Stockholm','SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.goto('/intake/accounting?view=settings')
    const section = page.getByRole('region', { name: t.heading, exact: true })
    await expect(section.getByText(t.off, { exact: true })).toBeVisible()
    await expect(section.getByText(t.helpScope)).toBeHidden()
    await section
      .getByRole('button', { name: t.help, exact: true })
      .press('Enter')
    await expect(section.getByText(t.helpScope)).toBeVisible()
    await section
      .getByRole('button', { name: t.help, exact: true })
      .press('Enter')
    await page.route(
      '**/api/automation-grants',
      async (route) => {
        await route.fetch()
        await route.abort('failed')
      },
      { times: 1 },
    )
    await section.getByRole('button', { name: t.enable, exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText(t.failed)
    await page.reload()
    await expect(section.getByText(t.waiting, { exact: true })).toBeVisible()
    await expect(
      section.getByRole('button', { name: t.disable, exact: true }),
    ).toBeVisible()
    const grants = (
      await f.db.query(
        "select id,identity_email from automation_grants where tenant_id=$1 and scope='day_close' and disabled_at is null",
        [f.tenant],
      )
    ).rows
    expect(grants).toHaveLength(1)
    expect(grants[0].identity_email).toBe('automation-e2e@example.test')
    let worker = (
      await f.db.query('select id from auth.users where email=$1 limit 1', [
        grants[0].identity_email,
      ])
    ).rows[0]?.id
    if (!worker) {
      worker = randomUUID()
      await f.db.query(
        'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
        [worker, grants[0].identity_email],
      )
    }
    await f.db.query(
      "update automation_grants set enabled_at=((now() at time zone 'Europe/Stockholm')::date-1)::timestamp at time zone 'Europe/Stockholm' where id=$1",
      [grants[0].id],
    )
    await f.asActor(worker, async () => {
      await f.db.query('select accept_automation_grants()')
      await f.db.query('select run_automatic_day_closes($1,$2)', [
        f.tenant,
        randomUUID(),
      ])
    })
    await page.reload()
    await expect(section.getByText(t.enabled, { exact: true })).toBeVisible()
    await expect(section.getByText(new RegExp(t.preparedThrough))).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from day_closes where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_exports where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('automatic-close-mobile.png'),
      fullPage: true,
    })
    await section.getByRole('button', { name: t.disable, exact: true }).click()
    await expect(section.getByText(t.off, { exact: true })).toBeVisible()
    await expect(section.getByText(new RegExp(t.preparedThrough))).toBeHidden()
    await expect(
      f.asActor(worker, () =>
        f.db.query('select run_automatic_day_closes($1,$2)', [
          f.tenant,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow('FORBIDDEN')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from day_closes where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
