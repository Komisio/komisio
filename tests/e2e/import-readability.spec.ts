import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }
import no from '../../messages/no.json' with { type: 'json' }
import dk from '../../messages/dk.json' with { type: 'json' }
import fi from '../../messages/fi.json' with { type: 'json' }
import de from '../../messages/de.json' with { type: 'json' }
import es from '../../messages/es.json' with { type: 'json' }
import it from '../../messages/it.json' with { type: 'json' }

test('localized file controls explain flexible CSV columns and preview without importing', async ({
  page,
}, testInfo) => {
  const email = `import-language-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    for (const [locale, messages] of Object.entries({
      sv: d,
      en,
      no,
      dk,
      fi,
      de,
      es,
      it,
    })) {
      const copy = messages.importer
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.goto('/intake/import')
      const choose = page.getByRole('button', {
        name: copy.chooseFile,
        exact: true,
      })
      await expect(choose).toBeEnabled()
      await expect(page.locator('#import-file')).toBeHidden()
      const info = page.getByRole('button', {
        name: copy.infoLabel,
        exact: true,
      })
      await expect(info).toHaveAttribute('aria-expanded', 'false')
      await info.press('Enter')
      await expect(
        page.getByText(copy.layoutHelp, { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText(copy.reviewHelp, { exact: true }),
      ).toBeVisible()
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        if (locale === 'sv')
          await page.screenshot({
            path: testInfo.outputPath(`import-info-${width}.png`),
            fullPage: true,
          })
      }
      await info.press('Escape')
      await expect(info).toHaveAttribute('aria-expanded', 'false')
      const chooser = page.waitForEvent('filechooser')
      await choose.press('Enter')
      await (
        await chooser
      ).setFiles({
        name: 'custom-columns.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'contact;person;extra\nsynthetic-import@example.test;Synthetic Seller;unused',
        ),
      })
      await expect(
        page.getByRole('button', { name: copy.changeFile, exact: true }),
      ).toBeVisible()
      await expect(page.locator('#import-file-name')).toHaveText(
        'custom-columns.csv',
      )
      await page.locator('#import-name').selectOption('1')
      await page.locator('#import-email').selectOption('0')
      const checkbox = await page
        .getByLabel(copy.skipHeader, { exact: true })
        .boundingBox()
      expect(checkbox?.width).toBe(20)
      expect(checkbox?.height).toBe(20)
      await expect(
        page.getByRole('region', { name: copy.preview, exact: true }),
      ).toContainText('Synthetic Seller')
      if (locale === 'sv') {
        await page.screenshot({
          path: testInfo.outputPath('import-preview-mobile.png'),
          fullPage: true,
        })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.screenshot({
          path: testInfo.outputPath('import-preview-desktop.png'),
          fullPage: true,
        })
      }
      await page
        .getByRole('button', { name: copy.clearFile, exact: true })
        .click()
      await expect(choose).toBeFocused()
      await expect(page.locator('#import-file-name')).toHaveText(copy.noFile)
    }
    expect(
      (
        await f.db.query(
          "select count(*)::int n from pending_operations where tenant_id=$1 and kind='importSellers'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sellers where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

for (const reply of ['lost', 'wrong-id'] as const)
  test(`seller import keeps the reviewed file frozen after a ${reply} response`, async ({
    page,
  }, testInfo) => {
    const email = `import-review-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/intake/import')
      const file = page.locator('#import-file')
      await expect(file).toBeEnabled()
      await file.setInputFiles({
        name: 'synthetic.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'name,email,phone\nSynthetic Imported Seller,synthetic-import@example.test,0700000000',
        ),
      })
      const preview = page.getByRole('region', {
        name: d.importer.preview,
        exact: true,
      })
      await expect(preview).toContainText('Synthetic Imported Seller')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/import', async (route) => {
        requests.push(route.request().postDataJSON())
        if (requests.length !== 1) return route.continue()
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.fulfill({
          status: reply === 'lost' ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            reply === 'lost'
              ? { error: 'REQUEST_FAILED' }
              : { ok: true, operationId: randomUUID() },
          ),
        })
      })
      await page
        .getByRole('button', { name: d.importer.import, exact: true })
        .click()
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.intake.failed)
      await expect(file).toBeDisabled()
      await expect(page.locator('#import-name')).toBeDisabled()
      await expect(
        page.getByLabel(d.importer.skipHeader, { exact: true }),
      ).toBeDisabled()
      await page
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect(preview.getByRole('status')).toContainText(
        d.importer.completed,
      )
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      await expect(
        preview.getByRole('link', { name: d.importer.viewSellers }),
      ).toHaveAttribute('href', '/intake/sellers')
      await expect(file).toBeEnabled()
      await expect(page.locator('#import-name')).toBeDisabled()
      expect(
        (
          await f.db.query(
            "select id from pending_operations where tenant_id=$1 and kind='importSellers'",
            [f.tenant],
          )
        ).rows,
      ).toHaveLength(1)
      expect(
        (
          await f.db.query(
            'select count(*)::int count from sellers where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].count,
      ).toBe(2)
      await page.screenshot({
        path: testInfo.outputPath('import-mobile.png'),
        fullPage: true,
        caret: 'initial',
      })
      await file.setInputFiles([])
      await expect(preview).not.toBeVisible()
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveCount(0)
      await file.setInputFiles({
        name: 'empty.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(''),
      })
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.importer.nothing)
      await file.setInputFiles({
        name: 'large.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('x'.repeat(2_000_001)),
      })
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.importer.fileTooLarge)
      const many = [
        'name,email,phone',
        ...Array.from(
          { length: 201 },
          (_, i) => `Synthetic ${i},seller-${i}@example.test,`,
        ),
      ].join('\n')
      await file.setInputFiles({
        name: 'too-many.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(many),
      })
      await expect(
        page.locator('.import-workspace').getByRole('alert'),
      ).toHaveText(d.importer.tooMany)
      await expect(
        page.getByRole('button', { name: d.importer.import, exact: true }),
      ).toBeDisabled()
    } finally {
      await f.close()
    }
  })

test('one Import click registers the whole preview and a lost approval response retries without duplicates', async ({
  page,
}, testInfo) => {
  const email = `import-confirm-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import')
    await expect(page.locator('#import-file')).toBeEnabled()
    await page.locator('#import-file').setInputFiles({
      name: 'synthetic-thirty.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'name,email,phone',
          ...Array.from(
            { length: 30 },
            (_, i) => `Synthetic Seller ${i + 1},import-${i}@example.test,`,
          ),
        ].join('\n'),
      ),
    })
    const preview = page.getByRole('region', {
      name: d.importer.preview,
      exact: true,
    })
    await expect(preview.getByRole('row')).toHaveCount(31)
    await expect(page.locator('.import-mapping')).not.toHaveAttribute('open')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sellers where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.screenshot({
      path: testInfo.outputPath('single-import-preview.png'),
      fullPage: true,
    })
    const decisions: Record<string, unknown>[] = []
    await page.route('**/api/operations', async (route) => {
      decisions.push(route.request().postDataJSON())
      const result = await route.fetch()
      expect(result.status()).toBe(200)
      if (decisions.length === 1) await route.abort('failed')
      else await route.fulfill({ response: result })
    })
    await page
      .getByRole('button', { name: d.importer.import, exact: true })
      .click()
    await expect(
      page.locator('.import-workspace').getByRole('alert'),
    ).toHaveText(d.intake.failed)
    await expect(page.locator('#import-file')).toBeDisabled()
    await expect(preview.getByRole('status')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sellers where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(31)
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(preview.getByRole('status')).toContainText(
      d.importer.completed,
    )
    await expect(page).toHaveURL('/intake/import')
    expect(decisions).toHaveLength(2)
    expect(decisions[1]).toEqual(decisions[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sellers where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(31)
    expect(
      (
        await f.db.query(
          'select outcome from operation_decisions where tenant_id=$1 and id=$2',
          [f.tenant, decisions[0].requestId],
        )
      ).rows,
    ).toEqual([{ outcome: 'executed' }])
    await expect(
      page.getByRole('link', { name: d.importer.viewSellers }),
    ).toHaveAttribute('href', '/intake/sellers')
  } finally {
    await f.close()
  }
})

test('a failed decision does not claim that sellers were imported', async ({
  page,
}) => {
  const email = `import-failed-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import')
    await expect(page.locator('#import-file')).toBeEnabled()
    await page
      .locator('#import-file')
      .setInputFiles({
        name: 'synthetic.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'name,email\nSynthetic Seller,synthetic@example.test',
        ),
      })
    await page.route('**/api/operations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: route.request().postDataJSON().requestId,
          outcome: 'failed',
          resultId: null,
        }),
      }),
    )
    await page
      .getByRole('button', { name: d.importer.import, exact: true })
      .click()
    await expect(
      page.locator('.import-workspace').getByRole('alert'),
    ).toHaveText(d.importer.error)
    await expect(
      page.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByText(d.importer.completed, { exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sellers where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('import file selection waits for its client handler', async ({ page }) => {
  const email = `import-ready-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release!: () => void
  const scripts = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.commit()
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    await page.goto('/intake/import', { waitUntil: 'commit' })
    const file = page.locator('#import-file')
    const picker = page.getByRole('button', {
      name: d.importer.chooseFile,
      exact: true,
    })
    await expect(picker).toBeVisible()
    await expect(picker).toBeDisabled()
    await expect(file).toBeDisabled()
    release()
    await expect(file).toBeEnabled()
    await expect(picker).toBeEnabled()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('an oversized import is rejected before decoding and the next file can still be reviewed', async ({
  page,
}) => {
  const email = `import-size-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import')
    const input = page.locator('#import-file')
    await expect(input).toBeEnabled()
    await page.evaluate(() => {
      const original = File.prototype.text
      File.prototype.text = function () {
        if (this.name === 'oversized.csv')
          throw new Error('Oversized contents must not be decoded')
        return original.call(this)
      }
    })
    await input.setInputFiles({
      name: 'oversized.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(8_000_001, 120),
    })
    await expect(
      page.locator('.import-workspace').getByRole('alert'),
    ).toHaveText(d.importer.fileTooLarge)
    await expect(
      page.getByRole('button', { name: d.importer.import, exact: true }),
    ).toHaveCount(0)
    await input.setInputFiles({
      name: 'small.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'name,email,phone\nSynthetic small import,small@example.test,',
      ),
    })
    await expect(
      page.getByRole('region', { name: d.importer.preview, exact: true }),
    ).toContainText('Synthetic small import')
    await expect(
      page.locator('.import-workspace').getByRole('alert'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.importer.import, exact: true }),
    ).toBeEnabled()
  } finally {
    await f.close()
  }
})
