import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function setup(page: Page, mode = 'quick', printer = false) {
  const email = `save-next-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const printerId = randomUUID()
  if (printer)
    await f.db.query(
      "select register_printer($1,$2,'Synthetic next-item printer','tcp','127.0.0.1:9100','Synthetic',203,true)",
      [f.tenant, printerId],
    )
  const bag =
    mode === 'bag'
      ? (
          await f.db.query(
            'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
            [
              f.tenant,
              randomUUID(),
              f.seller,
              'Synthetic consecutive items',
              f.agreement,
            ],
          )
        ).rows[0].id
      : null
  await f.commit()
  await page.goto(bag ? `/intake/bags/${bag}/inspect` : '/intake/quick')
  if (!bag)
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
  if (printer) await page.locator('#quick-printer').selectOption(printerId)
  return { f, bag, printerId }
}

for (const mode of ['quick', 'bag']) {
  test(`${mode} save and next keeps context but clears item data and photo`, async ({
    page,
  }) => {
    const { f, bag, printerId } = await setup(page, mode, true)
    let releaseRefresh = () => {}
    const refreshed = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    try {
      if (bag)
        await page.route(
          (url) =>
            url.pathname === `/intake/bags/${bag}/inspect` &&
            url.searchParams.has('_rsc'),
          async (route) => {
            const response = await route.fetch()
            await refreshed
            await route.fulfill({ response })
          },
        )
      const commands: Record<string, unknown>[] = []
      page.on('request', (request) => {
        if (
          request.url().endsWith('/api/intake/quick') &&
          request.method() === 'POST'
        )
          commands.push(request.postDataJSON())
      })
      const description = page.locator('#quick-description')
      const price = page.locator('#quick-price')
      const note = page.locator('#quick-internal-note')
      const type = page.locator('#quick-item-type')
      const selected = await type
        .locator('option:not([value=""])')
        .first()
        .getAttribute('value')
      await type.selectOption(selected!)
      await description.fill('Synthetic first item')
      await price.fill('125,50')
      await note.fill('Synthetic first-item note')
      const buffer = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#8a6d4a' },
      })
        .png()
        .toBuffer()
      await page
        .locator('#quick-photo')
        .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer })
      const saveNext = page.getByRole('button', {
        name: d.quickIntake.saveAndNext,
        exact: true,
      })
      await expect(saveNext).toBeEnabled()
      await saveNext.click()
      const saved = page.locator('.quick-last-saved')
      await expect(saved).toContainText('Synthetic first item')
      await expect(saved).toContainText('Synthetic P2 seller')
      await expect(saved).toContainText('125,50')
      await expect(saved).toContainText(d.quickIntake.printed)
      await expect(description).toBeFocused()
      await expect(description).toHaveValue('')
      await expect(price).toHaveValue('')
      await expect(note).toHaveValue('')
      await expect(type).toHaveValue(selected!)
      await expect(page.locator('#quick-printer')).toHaveValue(printerId)
      await expect(page.locator('.quick-photo-picker img')).toHaveCount(0)
      expect(
        await page
          .locator('#quick-photo')
          .evaluate((el) => (el as HTMLInputElement).files?.length),
      ).toBe(0)
      const first = (
        await f.db.query('select id from items where tenant_id=$1', [f.tenant])
      ).rows[0].id
      await expect(saved.getByRole('link')).toHaveAttribute(
        'href',
        new RegExp(`/intake/items/${first}\\?`),
      )
      await expect(
        page.locator('.quick-reception > [role="status"]'),
      ).toContainText('125,50')
      await description.fill('Synthetic second item')
      if (bag) {
        // Type before the server refresh arrives, then retain that new draft.
        releaseRefresh()
        await expect(page.locator('#bag-registered')).toContainText(
          'Synthetic first item',
        )
        await expect(description).toHaveValue('Synthetic second item')
      }
      const draftUrl = page.url()
      page.once('dialog', (dialog) => dialog.dismiss())
      await saved.getByRole('link').click()
      await expect(page).toHaveURL(draftUrl)
      await expect(description).toHaveValue('Synthetic second item')
      for (const width of [1360, 390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
        await expect(description).toHaveValue('Synthetic second item')
        if (width !== 390)
          await page.locator('.quick-item').screenshot({
            path: test.info().outputPath(`next-${width}.png`),
            caret: 'initial',
          })
      }
      await price.fill('210')
      await saveNext.click()
      await expect(saved).toContainText('Synthetic second item')
      await expect(saved).not.toContainText('Synthetic first item')
      await expect(description).toBeFocused()
      if (bag)
        await expect(page.locator('#bag-registered')).toContainText(
          'Synthetic second item',
        )
      expect(commands).toHaveLength(2)
      expect(commands[1].requestId).not.toBe(commands[0].requestId)
      expect(commands[1].sellerId).toBe(f.seller)
      expect(commands[1].sessionId).toBeNull()
      expect(commands[1].internalNote).toBe('')
      const jobs = (
        await f.db.query(
          'select id,reference_id,printer_id from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows
      expect(jobs).toHaveLength(2)
      expect(
        new Set(jobs.map((job: { reference_id: string }) => job.reference_id))
          .size,
      ).toBe(2)
      expect(
        jobs.every(
          (job: { printer_id: string }) => job.printer_id === printerId,
        ),
      ).toBe(true)
    } finally {
      releaseRefresh()
      try {
        // Drain any delayed refresh left by an earlier assertion failure before
        // Playwright closes this page and starts the next test.
        await page.unrouteAll({ behavior: 'wait' })
      } finally {
        await f.close()
      }
    }
  })
}

test('save and next waits for an exact retry after a committed reply is lost', async ({
  page,
}) => {
  const { f } = await setup(page)
  try {
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/intake/quick', async (route) => {
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      if (commands.length === 1) await route.abort('connectionfailed')
      else await route.fulfill({ response })
    })
    await page.locator('#quick-description').fill('Synthetic lost reply item')
    await page.locator('#quick-price').fill('175')
    await page
      .getByRole('button', { name: d.quickIntake.saveAndNext, exact: true })
      .click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.uncertain,
    )
    await expect(page.locator('#quick-description')).toHaveValue(
      'Synthetic lost reply item',
    )
    await expect(page.locator('#quick-description')).toBeDisabled()
    await expect(page.locator('.quick-last-saved')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.quickIntake.submit, exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: d.quickIntake.retry, exact: true })
      .click()
    await expect(page.locator('.quick-last-saved')).toContainText(
      'Synthetic lost reply item',
    )
    await expect(page.locator('#quick-description')).toBeFocused()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('missing accepted-price evidence keeps the full confirmation', async ({
  page,
}) => {
  const { f } = await setup(page)
  try {
    await page.route('**/api/intake/quick', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      delete body.price
      await route.fulfill({ response, json: body })
    })
    await page
      .locator('#quick-description')
      .fill('Synthetic missing-price evidence')
    await page.locator('#quick-price').fill('120')
    await page
      .getByRole('button', { name: d.quickIntake.saveAndNext, exact: true })
      .click()
    await expect(page.locator('.quick-done')).toContainText(
      d.quickIntake.savedPriceUnavailable,
    )
    await expect(page.locator('.quick-last-saved')).toHaveCount(0)
    await expect(page.locator('.quick-done h2')).toBeFocused()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

for (const status of [503, 403]) {
  test(`save and next stops for a ${status} print-queue result`, async ({
    page,
  }) => {
    const { f } = await setup(page, 'quick', true)
    try {
      const commands: Record<string, unknown>[] = []
      await page.route('**/api/print', async (route) => {
        commands.push(route.request().postDataJSON())
        if (commands.length > 1) return route.continue()
        if (status === 503) await route.fetch()
        await route.fulfill({
          status,
          json: { error: status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED' },
        })
      })
      await page.locator('#quick-description').fill('Synthetic print recovery')
      await page.locator('#quick-price').fill('120')
      await page
        .getByRole('button', { name: d.quickIntake.saveAndNext, exact: true })
        .click()
      const done = page.locator('.quick-done')
      await expect(done.getByRole('alert')).toHaveText(
        d.quickIntake.printFailed,
      )
      await expect(page.locator('.quick-last-saved')).toHaveCount(0)
      await expect(
        done.getByRole('link', { name: d.quickIntake.openPrintQueue }),
      ).toBeVisible()
      if (status === 503) {
        await done
          .getByRole('button', { name: d.quickIntake.retryPrint, exact: true })
          .click()
        await expect(done.getByRole('status')).toHaveText(d.quickIntake.printed)
        expect(commands).toHaveLength(2)
        expect(commands[1]).toEqual(commands[0])
        expect(
          (
            await f.db.query(
              'select count(*)::int n from print_jobs where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
        ).toBe(1)
      }
      await expect(done).toBeVisible()
      expect(
        (
          await f.db.query(
            'select count(*)::int n from items where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(1)
    } finally {
      await f.close()
    }
  })
}

test('save and next focuses price when the store hides description', async ({
  page,
}) => {
  const { f } = await setup(page)
  try {
    await f.asActor(f.actor, () =>
      f.db.query(
        `select publish_registration_settings($1,$2,null,
        (registration_settings($1)->'settings') || '{"hiddenFields":["description"]}'::jsonb)`,
        [f.tenant, randomUUID()],
      ),
    )
    await page.reload()
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const price = page.locator('#quick-price')
    await expect(page.locator('#quick-description')).toHaveCount(0)
    await price.fill('89')
    await price.press('Enter')
    await expect(page.locator('.quick-last-saved')).toContainText('89,00')
    await expect(price).toBeFocused()
    await expect(price).toHaveValue('')
  } finally {
    await f.close()
  }
})
