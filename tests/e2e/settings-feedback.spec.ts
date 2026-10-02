import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('saved account and store messages never describe a later unsubmitted edit', async ({
  page,
}) => {
  const email = `settings-feedback-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release = () => {}
  try {
    await f.commit()
    await page.goto('/account')
    const form = page
      .locator('form')
      .filter({ has: page.locator('#profile-name') })
    const name = form.locator('#profile-name')
    await name.fill('Synthetic saved name')
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let savedStatus = 0
    await page.route(
      '**/api/platform',
      async (route) => {
        if (route.request().postDataJSON()?.action !== 'profile')
          return route.continue()
        const response = await route.fetch()
        savedStatus = response.status()
        await gate
        await route.fulfill({ response })
      },
      { times: 1 },
    )
    await form.getByRole('button', { name: d.save, exact: true }).click()
    await expect(name).toBeDisabled()
    await expect(form.locator('#profile-language')).toBeDisabled()
    await expect.poll(() => savedStatus).toBe(200)
    release()
    await expect(form.locator('.notice-success')).toHaveText(d.saved)
    await expect(page.locator('.account-label').first()).toContainText(
      'Synthetic saved name',
    )
    await expect(name).toBeEnabled()
    await name.fill('Synthetic not saved yet')
    await expect(form.locator('.notice-success')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select display_name from user_profiles where user_id=$1',
          [f.actor],
        )
      ).rows[0].display_name,
    ).toBe('Synthetic saved name')
    await page.locator('.sidebar-nav a[href="/settings"]').click()
    await page.locator('.view-tab[href="/settings?tab=store"]').click()
    const tenant = page
      .locator('form')
      .filter({ has: page.locator('#tenant-name') })
    await tenant.locator('#tenant-name').fill('Synthetic confirmed store')
    await tenant.getByRole('button', { name: d.save, exact: true }).click()
    await expect(tenant.locator('.notice-success')).toHaveText(d.saved)
    await tenant.locator('#tenant-name').fill('Synthetic store draft')
    await expect(tenant.locator('.notice-success')).toHaveCount(0)
    expect(
      (await f.db.query('select name from tenants where id=$1', [f.tenant]))
        .rows[0].name,
    ).toBe('Synthetic confirmed store')
  } finally {
    release()
    await f.close()
  }
})

test('template edits discard stale preview replies and clear an obsolete image', async ({
  page,
}) => {
  const email = `template-preview-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  let release = () => {}
  try {
    await f.commit()
    await page.goto('/settings?tab=printing')
    await page.locator('.label-templates-fold > summary').click()
    const editor = page.locator('.label-template-editor')
    const zpl = editor.locator('textarea')
    const before = '^XA^FO10,10^FD{reference} before^FS^XZ'
    const after = '^XA^FO10,10^FD{reference} after^FS^XZ'
    await zpl.fill(before)
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const requests: string[] = []
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCMsAAAAASUVORK5CYII='
    // Only the browser preview response is simulated; no renderer is contacted.
    await page.route('**/api/print/preview', async (route) => {
      requests.push(route.request().postDataJSON().zpl)
      if (requests.length === 1) await gate
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ image }),
      })
    })
    const preview = editor.getByRole('button', {
      name: d.printing.preview,
      exact: true,
    })
    const save = editor.getByRole('button', {
      name: d.printing.saveTemplate,
      exact: true,
    })
    await preview.click()
    await expect.poll(() => requests.length).toBe(1)
    await expect(save).toBeDisabled()
    await zpl.fill(after)
    release()
    await expect(preview).toBeEnabled()
    await expect(editor.getByRole('img')).toHaveCount(0)
    await expect(zpl).toHaveValue(after)
    await preview.click()
    await expect(editor.getByRole('img')).toHaveAttribute('src', image)
    expect(requests).toEqual([before, after])
    await editor
      .getByRole('button', { name: d.printing.copyBuiltin, exact: true })
      .click()
    await expect(editor.getByRole('img')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from label_templates where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    release()
    await f.close()
  }
})
