import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function fixture(page: Page) {
  const email = `import-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/import')
    await page.locator('#import-file').setInputFiles({
      name: 'synthetic-mapped.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'first,contact,tel\nSynthetic Draft Seller,synthetic-draft@example.test,0700000000',
      ),
    })
    await page.locator('#import-name').selectOption('0')
    await page.locator('#import-email').selectOption('1')
    await page.locator('#import-phone').selectOption('2')
    await expect(
      page.getByRole('region', { name: d.importer.preview, exact: true }),
    ).toContainText('synthetic-draft@example.test')
    return f
  } catch (error) {
    await f.close()
    throw error
  }
}
async function cancelLeave(page: Page, link: Locator) {
  const prompt = page.waitForEvent('dialog')
  const click = link.click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

test('cancelled import navigation retains the file and mapping; clearing it releases navigation', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    const back = page.locator('main .page-heading a')
    await cancelLeave(page, back)
    await cancelLeave(page, page.locator('.sidebar a[href="/intake/items"]'))
    await expect(page.locator('#import-name')).toHaveValue('0')
    await expect(page.locator('#import-email')).toHaveValue('1')
    await expect(page.locator('#import-phone')).toHaveValue('2')
    expect(
      await page
        .locator('#import-file')
        .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
    ).toBe('synthetic-mapped.csv')
    const unloading = page.waitForEvent('dialog')
    const navigating = page.evaluate(() => {
      const nativeLink = document.createElement('a')
      nativeLink.href = '/intake/sellers'
      document.body.append(nativeLink)
      nativeLink.click()
      nativeLink.remove()
    })
    const prompt = await unloading
    expect(prompt.type()).toBe('beforeunload')
    await prompt.dismiss()
    await navigating
    await expect(page).toHaveURL('/intake/import')
    await expect(page.locator('#import-email')).toHaveValue('1')
    await page
      .getByRole('button', { name: d.importer.clearFile, exact: true })
      .click()
    await expect(page.locator('#import-file')).toBeFocused()
    await expect(
      page.getByRole('region', { name: d.importer.preview, exact: true }),
    ).toHaveCount(0)
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await back.click()
    await expect(page).toHaveURL('/intake/sellers')
    expect(warnings).toBe(0)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from pending_operations where tenant_id=$1 and kind='importSellers'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('unconfirmed import staging keeps its leave warning and exact retry; confirmed staging releases it', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/import', async (route) => {
      requests.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (requests.length === 1) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.importer.stage, exact: true })
      .click()
    const retry = page.getByRole('button', {
      name: d.intake.retry,
      exact: true,
    })
    await expect(retry).toBeVisible()
    await cancelLeave(page, page.locator('main .page-heading a'))
    await expect(page.locator('#import-email')).toBeDisabled()
    await expect(
      page.getByRole('button', { name: d.importer.clearFile, exact: true }),
    ).toBeDisabled()
    await retry.click()
    const queued = page.getByRole('link', {
      name: d.importer.openQueue,
      exact: true,
    })
    await expect(queued).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await queued.click()
    await expect(page).toHaveURL(`/intake/operations/${requests[0].requestId}`)
    expect(warnings).toBe(0)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from pending_operations where tenant_id=$1 and kind='importSellers'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
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
