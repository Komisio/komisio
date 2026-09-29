import {
  test,
  expect,
  type Dialog,
  type Locator,
  type Page,
} from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function leave(page: Page, control: Locator, accept: boolean) {
  const waiting = page.waitForEvent('dialog')
  const clicking = control.click()
  const dialog = await waiting
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.quickIntake.leaveItem)
  if (accept) await dialog.accept()
  else await dialog.dismiss()
  await clicking
}

test('quick intake keeps entered data when staff cancel app navigation', async ({
  page,
}) => {
  const email = `navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic interrupted intake')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('140')
    const unexpected = async (dialog: Dialog) => {
      throw new Error(`Unexpected navigation dialog: ${dialog.message()}`)
    }
    page.on('dialog', unexpected)
    await page.locator('.mobile-nav a[href="/intake/quick"]').click()
    await expect(description).toHaveValue('Synthetic interrupted intake')
    const popup = page.context().waitForEvent('page')
    await page
      .locator('.mobile-nav a[href="/intake/items"]')
      .click({ modifiers: ['Control'] })
    const newTab = await popup
    await expect(newTab).toHaveURL('/intake/items')
    await newTab.close()
    await expect(description).toHaveValue('Synthetic interrupted intake')
    page.off('dialog', unexpected)
    for (const control of [
      page.locator('.intake-header a[href="/intake"]'),
      page.locator('.mobile-nav a[href="/intake/items"]'),
      page.locator('.topbar a.brand'),
    ]) {
      await leave(page, control, false)
      await expect(page).toHaveURL('/intake/quick')
      await expect(description).toHaveValue('Synthetic interrupted intake')
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await leave(
      page,
      page.getByRole('button', { name: d.logout, exact: true }),
      false,
    )
    await expect(description).toHaveValue('Synthetic interrupted intake')
    await leave(
      page,
      page.locator('.sidebar-nav a[href="/intake/items"]'),
      true,
    )
    await expect(page).toHaveURL('/intake/items')

    // An unmounted form must not leave a warning registered in the shell.
    let unexpectedDialogs = 0
    page.on('dialog', async (dialog) => {
      unexpectedDialogs++
      await dialog.accept()
    })
    await page.locator('.sidebar-nav a[href="/intake/quick"]').click()
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(description).toHaveValue('')
    await description.fill('Synthetic completed intake')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('150')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toBeVisible()
    await page.locator('.sidebar-nav a[href="/intake/items"]').click()
    await expect(page).toHaveURL('/intake/items')
    expect(unexpectedDialogs).toBe(0)
  } finally {
    await f.close()
  }
})

test('cancelling a store switch keeps the active store and entered item', async ({
  page,
}) => {
  const email = `navigation-store-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const other = (
      await f.db.query('select create_tenant($1,$2,$3) id', [
        'Synthetic other store',
        `other-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake/quick')
    const stores = page.getByRole('combobox', {
      name: d.activeTenant,
      exact: true,
    })
    if ((await stores.inputValue()) !== f.tenant) {
      await Promise.all([page.waitForURL('/'), stores.selectOption(f.tenant)])
      await page.goto('/intake/quick')
    }
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic store-bound item')
    let selectionRequests = 0
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/platform') &&
        request.method() === 'POST' &&
        request.postDataJSON()?.action === 'select'
      )
        selectionRequests++
    })
    const waiting = page.waitForEvent('dialog')
    const selecting = stores.selectOption(other)
    const dialog = await waiting
    expect(dialog.message()).toBe(d.quickIntake.leaveItem)
    await dialog.dismiss()
    await selecting
    await expect(stores).toHaveValue(f.tenant)
    await expect(description).toHaveValue('Synthetic store-bound item')
    expect(selectionRequests).toBe(0)
  } finally {
    await f.close()
  }
})

test('cancelling navigation preserves an uncertain item attempt and its retry', async ({
  page,
}) => {
  const email = `navigation-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic uncertain intake')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('160')
    const commands: unknown[] = []
    await page.route('**/api/intake/quick', async (route) => {
      commands.push(route.request().postDataJSON())
      if (commands.length > 1) return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.uncertain,
    )
    await leave(page, page.locator('.intake-header a[href="/intake"]'), false)
    await expect(description).toBeDisabled()
    await page.locator('.quick-finish').getByRole('button').click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toBeVisible()
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

test('bag intake keeps an unfinished item while staff inspect its navigation choices', async ({
  page,
}) => {
  const email = `navigation-bag-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic guarded bag',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/intake/bags/${bag}/inspect`)
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic registered scarf')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('80')
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(page.locator('.bag-received-items li')).toHaveCount(1)
    await page
      .getByRole('button', { name: d.bagIntake.next, exact: true })
      .click()
    await description.fill('Synthetic unfinished scarf')
    await page.locator('a[href="#bag-registered"]').click()
    await expect(description).toHaveValue('Synthetic unfinished scarf')
    for (const control of [
      page.locator('.bag-received-items a').first(),
      page.locator('.bag-inspection-links a[href="?view=drafts"]'),
      page.getByRole('link', { name: d.intake.back, exact: true }),
    ]) {
      await leave(page, control, false)
      await expect(description).toHaveValue('Synthetic unfinished scarf')
    }
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
