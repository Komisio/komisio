import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }
import de from '../../messages/de.json' with { type: 'json' }

async function openQuickPrint(page: Page, locale = 'sv') {
  const email = `quick-print-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const printer = randomUUID()
  await f.db.query(
    "select register_printer($1,$2,'Synthetic quick printer','tcp','127.0.0.1:9100','Synthetic',203,true)",
    [f.tenant, printer],
  )
  await f.commit()
  await page
    .context()
    .addCookies([
      { name: 'komisio-locale', value: locale, url: 'http://127.0.0.1:3000' },
    ])
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/intake/quick')
  await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
  await page.locator('#quick-description').fill('Synthetic print recovery item')
  await page.locator('#quick-price').fill('200')
  await page.locator('#quick-printer').selectOption(printer)
  return { f, printer }
}

for (const variant of [
  'lost',
  'uncommitted',
  'wrong-id',
  'missing-ok',
] as const) {
  test(`quick label ${variant} retries only its print job and keeps the accepted item`, async ({
    page,
  }, testInfo) => {
    const locale = variant === 'wrong-id' ? 'de' : 'sv'
    const d = (locale === 'de' ? de : sv).quickIntake
    const { f, printer } = await openQuickPrint(page, locale)
    try {
      let acceptances = 0
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().endsWith('/api/intake/quick')
        )
          acceptances++
      })
      const commands: Record<string, unknown>[] = []
      await page.route('**/api/print', async (route) => {
        commands.push(route.request().postDataJSON())
        if (commands.length > 1) return route.continue()
        if (variant === 'lost' || variant === 'missing-ok') {
          const response = await route.fetch()
          expect(response.status()).toBe(200)
        }
        await route.fulfill({
          status: variant === 'lost' || variant === 'uncommitted' ? 503 : 200,
          json:
            variant === 'wrong-id'
              ? { ok: true, id: randomUUID() }
              : variant === 'missing-ok'
                ? { id: commands[0].requestId }
                : { error: 'REQUEST_FAILED' },
        })
      })
      await page.getByRole('button', { name: d.submit, exact: true }).click()
      const done = page.getByRole('region', { name: d.done, exact: true })
      await expect(done.getByRole('alert')).toHaveText(d.printFailed)
      await expect(done.getByText(d.printed, { exact: true })).toHaveCount(0)
      await expect(
        done.getByRole('link', { name: d.openPrintQueue }),
      ).toHaveAttribute('href', '/settings?tab=printing#print-jobs')
      if (variant === 'lost') {
        const opened = page.context().waitForEvent('page')
        await done
          .getByRole('link', { name: d.openPrintQueue })
          .click({ modifiers: ['Control'] })
        const queuePage = await opened
        await expect(queuePage.locator('#print-jobs')).toHaveText(
          sv.printing.jobs,
        )
        await expect(queuePage.locator('#print-jobs')).toBeInViewport()
        await queuePage.close()
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath('quick-print-retry-mobile.png'),
      })
      expect(
        (
          await f.db.query(
            'select count(*)::int n from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(variant === 'lost' || variant === 'missing-ok' ? 1 : 0)
      const replied = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/print') &&
          response.request().method() === 'POST',
      )
      await done
        .getByRole('button', { name: d.retryPrint, exact: true })
        .click()
      expect((await replied).status()).toBe(200)
      await expect(done.getByRole('status')).toHaveText(d.printed)
      await expect(done.getByRole('alert')).toHaveCount(0)
      await expect(
        done.getByRole('button', { name: d.retryPrint, exact: true }),
      ).toHaveCount(0)
      await expect(done.getByRole('heading')).toBeFocused()
      expect(commands).toHaveLength(2)
      expect(commands[1]).toEqual(commands[0])
      expect(commands[0].printerId).toBe(printer)
      expect(acceptances).toBe(1)
      expect(
        (
          await f.db.query(
            'select count(*)::int n from items where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(1)
      expect(
        (
          await f.db.query(
            'select id,reference_id from print_jobs where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([
        { id: commands[0].requestId, reference_id: commands[0].referenceId },
      ])
      if (variant === 'lost') {
        await done.getByRole('button', { name: d.next, exact: true }).click()
        await page
          .locator('#quick-description')
          .fill('Synthetic second printed item')
        await page.locator('#quick-price').fill('210')
        await page.getByRole('button', { name: d.submit, exact: true }).click()
        await expect(done.getByRole('status')).toHaveText(d.printed)
        expect(acceptances).toBe(2)
        expect(commands).toHaveLength(3)
        expect(commands[2].requestId).not.toBe(commands[0].requestId)
        expect(commands[2].referenceId).not.toBe(commands[0].referenceId)
        expect(
          (
            await f.db.query(
              'select count(*)::int n from print_jobs where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
        ).toBe(2)
      }
    } finally {
      await f.close()
    }
  })
}

test('item acceptance is visible while its optional label queue reply is pending', async ({
  page,
}) => {
  const d = sv.quickIntake
  const { f } = await openQuickPrint(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = () => {}
  const printing = new Promise<void>((resolve) => {
    started = resolve
  })
  try {
    await page.route('**/api/print', async (route) => {
      started()
      await held
      await route.continue()
    })
    await page.getByRole('button', { name: d.submit, exact: true }).click()
    await printing
    const done = page.getByRole('region', { name: d.done, exact: true })
    await expect(done).toBeVisible()
    await expect(done.getByRole('heading')).toBeFocused()
    await expect(
      done.getByRole('button', { name: d.next, exact: true }),
    ).toBeDisabled()
    await expect(page.locator('.quick-item-form')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    release()
    await expect(done.getByRole('status')).toHaveText(d.printed)
    await expect(
      done.getByRole('button', { name: d.next, exact: true }),
    ).toBeEnabled()
  } finally {
    release()
    await f.close()
  }
})

test('a store change after item acceptance refuses print and offers reload', async ({
  page,
}) => {
  const d = sv.quickIntake
  const { f } = await openQuickPrint(page)
  try {
    await page.route('**/api/print', async (route) => {
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
      const response = await route.fetch()
      expect(response.status()).toBe(409)
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: d.submit, exact: true }).click()
    const done = page.getByRole('region', { name: d.done, exact: true })
    await expect(done.getByRole('alert')).toHaveText(d.printFailed)
    await expect(
      done.getByRole('button', { name: d.retryPrint, exact: true }),
    ).toHaveCount(0)
    await done.getByRole('button', { name: d.reload, exact: true }).click()
    await expect(
      page.getByRole('region', { name: d.seller, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Synthetic P2 seller/ }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
