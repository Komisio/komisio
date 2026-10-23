import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('setup tracks keep drafts and scoped checklist observations without activating printers', async ({
  page,
}, testInfo) => {
  const email = `onboarding-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email),
    a = randomUUID(),
    b = randomUUID()
  try {
    for (const [id, name] of [
      [a, 'Weblink A'],
      [b, 'Weblink B'],
    ])
      await f.db.query(
        "select register_weblink_printer($1,$2,$3,'ZD420',203)",
        [f.tenant, id, name],
      )
    await f.commit()
    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto('/settings?tab=printing')
    const download = page.getByRole('link', {
      name: d.printing.download,
      exact: true,
    })
    await expect(download).toBeHidden()
    const windows = page.getByRole('radio', {
      name: d.printing.setup.windows,
      exact: false,
    })
    await expect(windows).toBeEnabled()
    await windows.focus()
    await page.keyboard.press('Space')
    await expect(download).toBeVisible()
    const form = page.locator('.printer-register-fold')
    await form.locator('summary').click()
    await form
      .getByLabel(d.printing.name, { exact: true })
      .fill('Unsaved Windows draft')
    await page
      .getByRole('radio', { name: d.printing.setup.weblink, exact: false })
      .check()
    await expect(download).toBeHidden()
    await expect(form).toBeHidden()
    await windows.check()
    await expect(form.getByLabel(d.printing.name, { exact: true })).toHaveValue(
      'Unsaved Windows draft',
    )
    await form.getByLabel(d.printing.name, { exact: true }).fill('')
    await page
      .getByRole('radio', { name: d.printing.setup.weblink, exact: false })
      .check()
    const fold = page
      .locator('.printing-printers > details')
      .filter({ has: page.locator('summary', { hasText: 'Weblink A' }) })
    await fold.locator('summary').click()
    await expect(
      fold.getByText(d.printing.weblink.managed.unavailable),
    ).toBeVisible()
    await expect(
      fold.getByRole('button', { name: d.printing.newCode, exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('tab', { name: d.printing.tabs.install, exact: true })
      .click()
    await page
      .getByLabel(d.printing.setup.forPrinter, { exact: true })
      .selectOption(a)
    const step = (id: string) =>
      page.locator(`.printer-checklist [data-step="${id}"]`)
    await expect(step('register').getByRole('checkbox')).toBeChecked()
    await expect(step('register').getByRole('checkbox')).toBeDisabled()
    await expect(step('enabled').getByRole('checkbox')).not.toBeChecked()
    await step('support').getByRole('checkbox').check()
    await step('file').getByRole('checkbox').check()
    await step('file').locator('summary').click()
    await expect(
      page.getByRole('img', {
        name: d.printing.setup.illustration,
        exact: true,
      }),
    ).toBeVisible()
    await page.setViewportSize({ width: 320, height: 900 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('weblink-checklist-320.png'),
      fullPage: true,
    })
    await step('file')
      .locator('figure')
      .screenshot({
        path: testInfo.outputPath('weblink-illustrations.png'),
      })
    await page.reload()
    await expect(step('file').getByRole('checkbox')).toBeChecked()
    await expect(step('support').getByRole('checkbox')).toBeChecked()
    await page
      .getByLabel(d.printing.setup.forPrinter, { exact: true })
      .selectOption(b)
    await expect(step('file').getByRole('checkbox')).not.toBeChecked()
    await page
      .getByLabel(d.printing.setup.forPrinter, { exact: true })
      .selectOption(a)
    await expect(step('file').getByRole('checkbox')).toBeChecked()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from printers where tenant_id=$1 and active',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    // Pair through the existing engine as a synthetic anonymous device.
    const user = randomUUID()
    await f.db.query(
      'insert into auth.users(id,is_anonymous) values($1,true)',
      [user],
    )
    const code = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select create_print_pairing_code($1,$2) value', [
            f.tenant,
            a,
          ])
        ).rows[0].value.code,
    )
    await f.asActor(user, async () => {
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: user,
          role: 'authenticated',
          is_anonymous: true,
        }),
      ])
      await f.db.query(
        "select pair_print_device($1,'Synthetic device','test')",
        [code],
      )
    })
    await page.reload()
    await expect(step('prepare').getByRole('checkbox')).toBeChecked()
    // A fresh paired identity requires its own file transfer observation.
    await expect(step('file').getByRole('checkbox')).not.toBeChecked()
    await expect(step('seen').getByRole('checkbox')).not.toBeChecked()
    await expect(step('enabled').getByRole('checkbox')).not.toBeChecked()
    const device = (
      await f.db.query('select id from print_devices where user_id=$1', [user])
    ).rows[0].id
    await f.asActor(f.actor, () =>
      f.db.query('select set_weblink_pilot($1,$2,true,$3,true)', [
        f.tenant,
        a,
        device,
      ]),
    )
    await f.asActor(user, async () => {
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: user,
          role: 'authenticated',
          is_anonymous: true,
        }),
      ])
      await f.db.query('select report_print_device($1)', [
        { printerReachable: true },
      ])
    })
    await page.reload()
    await expect(step('seen').getByRole('checkbox')).toBeChecked()
    await expect(step('enabled').getByRole('checkbox')).toBeChecked()
    const owner = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `owner-${randomUUID()}@example.test`],
    )
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
      [f.tenant, owner],
    )
    await f.db.query(
      "update tenant_members set role='readonly' where tenant_id=$1 and user_id=$2",
      [f.tenant, f.actor],
    )
    await page.reload()
    await expect(page.getByRole('radio')).toHaveCount(0)
    await expect(
      page.getByText(d.printing.weblink.managed.unavailable),
    ).toHaveCount(0)
    await expect(page.getByText(d.printing.setup.statusOnly)).toBeVisible()
    await page
      .getByRole('tab', { name: d.printing.tabs.printers, exact: true })
      .click()
    await expect(
      page.getByRole('button', {
        name: d.printing.weblink.register,
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.printing.newCode, exact: true }),
    ).toHaveCount(0)
  } finally {
    await f.close()
  }
})
