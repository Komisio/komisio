import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
const w = d.printing.weblink

for (const lost of [false, true])
  test(`Weblink setup stays inactive after ${lost ? 'lost' : 'confirmed'} response`, async ({
    page,
  }, testInfo) => {
    const email = `weblink-setup-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/settings?tab=printing')
      await page
        .getByRole('radio', { name: d.printing.setup.weblink, exact: false })
        .check()
      const fold = page.locator('.weblink-register-fold')
      await fold.locator('summary').click()
      const form = fold.locator('form')
      await form
        .getByLabel(d.printing.name, { exact: true })
        .fill('Synthetic Weblink')
      await form.getByLabel(d.printing.model, { exact: true }).fill('ZD420')
      expect(await form.locator('input[name="active"]').count()).toBe(0)
      let writes = 0
      await page.route('**/api/print/weblink', async (route) => {
        writes++
        const r = await route.fetch()
        expect(r.status()).toBe(200)
        if (lost)
          await route.fulfill({
            status: 503,
            json: { error: 'REQUEST_FAILED' },
          })
        else await route.fulfill({ response: r })
      })
      await form.getByRole('button', { name: w.register, exact: true }).click()
      if (lost) {
        await expect(form.getByRole('alert')).toContainText(w.unconfirmed)
        await expect(
          form.getByRole('button', { name: w.register, exact: true }),
        ).toBeDisabled()
      } else await expect(form.getByRole('status')).toHaveText(w.saved)
      expect(
        (
          await f.db.query(
            'select transport,active,name from printers where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([
        { transport: 'weblink', active: false, name: 'Synthetic Weblink' },
      ])
      expect(
        (
          await f.db.query(
            'select count(*)::int n from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(writes).toBe(1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      await page.screenshot({
        path: testInfo.outputPath('weblink-setup-mobile.png'),
        fullPage: true,
      })
      if (lost) {
        page.once('dialog', (dialog) => dialog.accept())
        await form
          .getByRole('button', { name: d.intake.reload, exact: true })
          .click()
      }
      await expect(
        page
          .locator('.printing-printers > details > summary')
          .filter({ hasText: 'Synthetic Weblink' }),
      ).toContainText(d.printing.inactiveLabel)
    } finally {
      await f.close()
    }
  })

for (const lost of [false, true])
  test(`Weblink ${lost ? 'unknown' : 'accepted'} outcome requires revocation and inspection`, async ({
    page,
  }, testInfo) => {
    const email = `weblink-recovery-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      const printer = randomUUID(),
        job = randomUUID(),
        deviceUser = randomUUID(),
        attempt = randomUUID()
      // Synthetic hardware fixture only. Public setup cannot activate printers.
      await f.db.query(
        "insert into printers(id,tenant_id,name,transport,address,created_by) values($1,$2,'Synthetic Weblink','weblink','',$3)",
        [printer, f.tenant, f.actor],
      )
      await f.db.query(
        'insert into auth.users(id,is_anonymous) values($1,true)',
        [deviceUser],
      )
      const code = await f.asActor(f.actor, async () => {
        await f.db.query(
          "select queue_print_job($1,$2,$3,'onboarding','zpl-v1','seller',$4,'^XA^FDTest^FS^XZ',2)",
          [f.tenant, job, printer, f.seller],
        )
        return (
          await f.db.query('select create_print_pairing_code($1,$2) value', [
            f.tenant,
            printer,
          ])
        ).rows[0].value.code
      })
      const device = await f.asActor(deviceUser, async () => {
        await f.db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({
            sub: deviceUser,
            role: 'authenticated',
            is_anonymous: true,
          }),
        ])
        const id = (
          await f.db.query(
            "select pair_print_device($1,'Synthetic bridge','test') value",
            [code],
          )
        ).rows[0].value.deviceId
        await f.db.query('select claim_weblink_print_job($1,$2,$3)', [
          f.tenant,
          printer,
          attempt,
        ])
        await f.db.query('select finish_weblink_print_job($1,$2,$3,$4)', [
          f.tenant,
          job,
          attempt,
          lost ? 'outcome_unknown' : 'transport_accepted',
        ])
        return id
      })
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(`/settings?tab=printing&job=${job}`)
      const detail = page.locator(`#print-job-${job}`)
      await expect(detail).toContainText(
        d.printing.statuses[lost ? 'outcome_unknown' : 'transport_accepted'],
      )
      await expect(detail).toContainText(w.acceptanceHint)
      await detail.locator('summary').click()
      const form = detail.locator('form')
      const save = form.getByRole('button', { name: w.resolve, exact: true })
      await expect(save).toBeDisabled()
      await detail.getByRole('button', { name: w.revoke, exact: true }).click()
      await expect(save).toBeEnabled()
      expect(
        (
          await f.db.query('select revoked_at from print_devices where id=$1', [
            device,
          ])
        ).rows[0].revoked_at,
      ).not.toBeNull()
      let resolutions = 0
      await page.route('**/api/print/weblink', async (route) => {
        const command = route.request().postDataJSON()
        if (command.action !== 'resolve') return route.continue()
        resolutions++
        const r = await route.fetch()
        expect(r.status()).toBe(200)
        if (lost)
          await route.fulfill({
            status: 200,
            json: { ok: true, id: randomUUID() },
          })
        else await route.fulfill({ response: r })
      })
      await save.click()
      expect(resolutions).toBe(0)
      await form.getByLabel(w.inspected, { exact: true }).check()
      await form
        .getByLabel(w.note, { exact: true })
        .fill('Stopped connection; inspected both labels and buffered jobs.')
      await form
        .getByRole('radio', {
          name: lost ? w.cancelled : w.printed,
          exact: true,
        })
        .check()
      await page.screenshot({
        path: testInfo.outputPath('weblink-recovery-mobile.png'),
        fullPage: true,
      })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      await save.click()
      if (lost) {
        await expect(form.getByRole('alert')).toContainText(w.unconfirmed)
        await expect(save).toBeDisabled()
        page.once('dialog', (dialog) => dialog.accept())
        await form
          .getByRole('button', { name: d.intake.reload, exact: true })
          .click()
      }
      await expect(detail).toContainText(
        'Stopped connection; inspected both labels and buffered jobs.',
      )
      await expect(detail.locator('form')).toHaveCount(0)
      if (!lost) await expect(detail).toContainText(w.printed)
      expect(resolutions).toBe(1)
      expect(
        (
          await f.db.query(
            'select count(*)::int n from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(1)
    } finally {
      await f.close()
    }
  })
