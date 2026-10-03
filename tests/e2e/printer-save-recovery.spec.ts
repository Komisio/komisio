import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Registering a printer edits mutable configuration. Its ID is not a replay
// token. An uncertain save must be inspected, not blindly replayed over newer edits.
for (const reply of [
  'lost',
  'validation-5xx',
  'wrong-id',
  'missing-ok',
  'null',
] as const)
  test(`an uncertain printer save (${reply}) reloads without overwriting a later edit`, async ({
    page,
  }) => {
    const email = `printer-save-recovery-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 720 })
      await page.goto('/settings?tab=printing')
      const form = page
        .locator('form')
        .filter({ has: page.locator('input[name="name"]') })
        .first()
      await form
        .getByLabel(d.printing.name, { exact: true })
        .fill('Synthetic printer save')
      await form
        .getByLabel(d.printing.address, { exact: true })
        .fill('127.0.0.1:9100')
      const requests: Record<string, unknown>[] = []
      let committedId = ''
      let firstStatus = 0
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        if (command?.action !== 'registerPrinter') return route.continue()
        requests.push(command)
        const response = await route.fetch()
        firstStatus = response.status()
        committedId = (await response.json()).id
        const failed = reply === 'lost' || reply === 'validation-5xx'
        await route.fulfill({
          status: failed ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            reply === 'lost'
              ? { error: 'REQUEST_FAILED' }
              : reply === 'validation-5xx'
                ? { error: 'INVALID_INPUT' }
                : reply === 'wrong-id'
                  ? { ok: true, id: randomUUID() }
                  : reply === 'missing-ok'
                    ? { id: committedId }
                    : null,
          ),
        })
      })
      await form
        .getByRole('button', { name: d.printing.register, exact: true })
        .click()
      await expect(form.getByRole('alert')).toHaveText(
        d.printing.printerUncertain,
      )
      expect(firstStatus).toBe(200)
      expect(committedId).toBe(requests[0].requestId)
      await f.asActor(f.actor, async () => {
        await f.db.query('select register_printer($1,$2,$3,$4,$5,$6,$7,$8)', [
          f.tenant,
          committedId,
          'Latest synthetic printer',
          'tcp',
          '127.0.0.1:9200',
          'Updated synthetic model',
          300,
          true,
        ])
      })
      const reload = form.getByRole('button', {
        name: d.intake.reload,
        exact: true,
      })
      await expect(reload).toBeVisible()
      const bounds = (await reload.boundingBox())!
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (reply === 'lost')
        await form.screenshot({ path: 'private/printer-recovery-form-320.png' })
      await expect(
        form.getByRole('button', { name: d.printing.register, exact: true }),
      ).toBeDisabled()
      // Even a direct submit event must not blindly replay this mutable upsert.
      await form.evaluate((node) => (node as HTMLFormElement).requestSubmit())
      expect(requests).toHaveLength(1)
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('beforeunload')
        await dialog.accept()
      })
      await reload.click()
      await expect(page).toHaveURL(/\/settings\?tab=printing$/)
      await expect(
        page.locator('summary').filter({ hasText: 'Latest synthetic printer' }),
      ).toBeVisible()
      expect(requests).toHaveLength(1)
      expect(
        (
          await f.db.query(
            'select id,name,address,model,dpi from printers where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([
        {
          id: committedId,
          name: 'Latest synthetic printer',
          address: '127.0.0.1:9200',
          model: 'Updated synthetic model',
          dpi: 300,
        },
      ])
      expect(
        (
          await f.db.query(
            'select count(*)::integer n from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(0)
    } finally {
      await f.close()
    }
  })

test('a printer address rejected before saving remains correctable', async ({
  page,
}) => {
  const email = `printer-validation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=printing')
    const form = page
      .locator('form')
      .filter({ has: page.locator('input[name="name"]') })
      .first()
    const address = form.getByLabel(d.printing.address, { exact: true })
    await form
      .getByLabel(d.printing.name, { exact: true })
      .fill('Synthetic corrected printer')
    await address.fill('not a printer address!')
    const save = form.getByRole('button', {
      name: d.printing.register,
      exact: true,
    })
    const refused = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'registerPrinter',
    )
    await save.click()
    expect((await refused).status()).toBe(400)
    await expect(form.getByRole('alert')).toHaveText(d.intake.invalid)
    await expect(address).toBeEnabled()
    await expect(
      form.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::integer n from printers where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await address.fill('127.0.0.1:9100')
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'registerPrinter',
    )
    await save.click()
    expect((await saved).status()).toBe(200)
    await expect(
      page
        .locator('summary')
        .filter({ hasText: 'Synthetic corrected printer' }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select name,address from printers where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([
      { name: 'Synthetic corrected printer', address: '127.0.0.1:9100' },
    ])
  } finally {
    await f.close()
  }
})

test('an uncertain printer update clears its previous confirmation', async ({
  page,
}) => {
  const email = `printer-update-confirmation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const printerId = randomUUID()
    await f.db.query('select register_printer($1,$2,$3,$4,$5,$6,$7,$8)', [
      f.tenant,
      printerId,
      'Initial synthetic printer',
      'tcp',
      '127.0.0.1:9100',
      'Synthetic model',
      203,
      true,
    ])
    await f.commit()
    await page.goto('/settings?tab=printing')
    await page
      .locator('summary')
      .filter({ hasText: 'Initial synthetic printer' })
      .click()
    const form = page
      .locator('form')
      .filter({ has: page.locator('input[name="name"]') })
      .first()
    await form
      .getByLabel(d.printing.name, { exact: true })
      .fill('Confirmed synthetic printer')
    const save = form.getByRole('button', {
      name: d.printing.update,
      exact: true,
    })
    await save.click()
    await expect(form.getByRole('status')).toHaveText(d.printing.saved)
    await expect(
      page
        .locator('summary')
        .filter({ hasText: 'Confirmed synthetic printer' }),
    ).toBeVisible()
    let posted = 0
    let status = 0
    await page.route('**/api/intake', async (route) => {
      if (route.request().postDataJSON()?.action !== 'registerPrinter')
        return route.continue()
      posted++
      const response = await route.fetch()
      status = response.status()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    await form
      .getByLabel(d.printing.model, { exact: true })
      .fill('Unconfirmed synthetic model')
    await expect(form.getByRole('status')).toHaveCount(0)
    await save.click()
    await expect(form.getByRole('alert')).toHaveText(
      d.printing.printerUncertain,
    )
    expect(status).toBe(200)
    expect(posted).toBe(1)
    await expect(form.getByRole('status')).toHaveCount(0)
    await expect(save).toBeDisabled()
    await expect(
      form.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select id,name,model from printers where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([
      {
        id: printerId,
        name: 'Confirmed synthetic printer',
        model: 'Unconfirmed synthetic model',
      },
    ])
  } finally {
    await f.close()
  }
})
