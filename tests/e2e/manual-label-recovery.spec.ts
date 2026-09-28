import { test, expect, type Page } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('manual label validation stays correctable and clears an earlier success', async ({
  page,
}) => {
  const { f, printer, copies, form } = await openPrint(page)
  try {
    let calls = 0
    await page.route('**/api/print', async (route) => {
      calls++
      if (calls === 1)
        return route.fulfill({ status: 400, json: { error: 'INVALID_INPUT' } })
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (calls === 2) return route.fulfill({ response })
      return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
    })
    const queue = form.getByRole('button', {
      name: d.printing.queue,
      exact: true,
    })
    await queue.click()
    await expect(form.getByRole('alert')).toHaveText(d.intake.invalid)
    await expect(printer).toBeEnabled()
    await copies.fill('3')
    await queue.click()
    await expect(form.getByRole('status')).toHaveText(d.printing.queued)
    await queue.click()
    await expect(form.getByRole('alert')).toBeVisible()
    await expect(form.getByRole('status')).toHaveCount(0)
    await expect(copies).toBeDisabled()
    expect(
      (
        await f.db.query('select copies from print_jobs where tenant_id=$1', [
          f.tenant,
        ])
      ).rows,
    ).toEqual([{ copies: 3 }, { copies: 3 }])
  } finally {
    await f.close()
  }
})

test('manual label reloads a changed active store without queueing', async ({
  page,
}) => {
  const { f, printer, form } = await openPrint(page)
  try {
    await f.asActor(f.actor, async () => {
      const other = (
        await f.db.query('select create_tenant($1,$2,$3) id', [
          'Other synthetic print store',
          `print-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      await f.db.query('select set_active_tenant($1)', [other])
    })
    const refused = page.waitForResponse((r) => r.url().endsWith('/api/print'))
    await form
      .getByRole('button', { name: d.printing.queue, exact: true })
      .click()
    expect((await refused).status()).toBe(409)
    await expect(form.getByRole('alert')).toHaveText(d.intake.changed)
    await expect(printer).toBeDisabled()
    await expect(
      form.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toBeDisabled()
    await expect(
      form.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await form
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(printer).toHaveCount(0)
  } finally {
    await f.close()
  }
})

async function openPrint(page: Page) {
  const email = `manual-label-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const item = await f.item('Synthetic recoverable label')
  const printers = [randomUUID(), randomUUID()]
  for (const [index, id] of printers.entries()) {
    await f.db.query(
      "select register_printer($1,$2,$3,'tcp','127.0.0.1:9100','Synthetic',203,true)",
      [f.tenant, id, `Synthetic printer ${index + 1}`],
    )
  }
  await f.commit()
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(`/intake/items/${item}`)
  const printer = page.locator(`#printer-${item}`)
  await page
    .locator('details')
    .filter({ has: printer })
    .locator('summary')
    .click()
  const form = page.locator('form').filter({ has: printer })
  const copies = page.locator(`#copies-${item}`)
  await printer.selectOption(printers[0])
  await copies.fill('2')
  return { f, item, printers, printer, copies, form }
}

for (const reply of [
  'lost',
  'wrong-id',
  'missing-ok',
  'validation-5xx',
] as const) {
  test(`manual label ${reply} keeps its printer, copies and queue identity`, async ({
    page,
  }) => {
    const { f, printers, printer, copies, form } = await openPrint(page)
    try {
      const commands: Record<string, unknown>[] = []
      let firstStatus = 0
      await page.route('**/api/print', async (route) => {
        commands.push(route.request().postDataJSON())
        if (commands.length > 1) return route.continue()
        const response = await route.fetch()
        firstStatus = response.status()
        await route.fulfill({
          status: ['lost', 'validation-5xx'].includes(reply) ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            reply === 'lost'
              ? { error: 'REQUEST_FAILED' }
              : reply === 'validation-5xx'
                ? { error: 'INVALID_INPUT' }
                : reply === 'missing-ok'
                  ? { id: commands[0].requestId }
                  : { ok: true, id: randomUUID() },
          ),
        })
      })
      await form
        .getByRole('button', { name: d.printing.queue, exact: true })
        .click()
      await expect(form.getByRole('alert')).toBeVisible()
      expect(firstStatus).toBe(200)
      await expect(form.getByRole('status')).toHaveCount(0)
      await expect(printer).toBeDisabled()
      await expect(copies).toBeDisabled()
      await form
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect(form.getByRole('status')).toHaveText(d.printing.queued)
      await expect(copies).toBeEnabled()
      expect(commands).toHaveLength(2)
      expect(commands[1]).toEqual(commands[0])
      expect(
        (
          await f.db.query(
            'select id,printer_id,copies from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([
        { id: commands[0].requestId, printer_id: printers[0], copies: 2 },
      ])
      expect(
        (
          await f.db.query(
            "select count(*)::int n from access_events where tenant_id=$1 and action='print.queued'",
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(1)
      // Another deliberate print starts a new job with the newly selected values.
      await printer.selectOption(printers[1])
      await copies.fill('3')
      await form
        .getByRole('button', { name: d.printing.queue, exact: true })
        .click()
      await expect(form.getByRole('status')).toHaveText(d.printing.queued)
      expect(commands).toHaveLength(3)
      expect(commands[2].requestId).not.toBe(commands[0].requestId)
      expect(
        (
          await f.db.query(
            'select printer_id,copies from print_jobs where tenant_id=$1 order by created_at,id',
            [f.tenant],
          )
        ).rows,
      ).toEqual([
        { printer_id: printers[0], copies: 2 },
        { printer_id: printers[1], copies: 3 },
      ])
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    } finally {
      await f.close()
    }
  })
}
