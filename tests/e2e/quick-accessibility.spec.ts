import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('quick photo uses its visible label and keeps one status region mounted', async ({
  page,
}) => {
  const email = `quick-a11y-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    const status = page.locator('.quick-reception > [role="status"]')
    await expect(status).toHaveCount(1)
    await expect(status).toHaveText('')
    const original = await status.elementHandle()
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(
      page.getByLabel(d.quickIntake.addPhoto, { exact: true }),
    ).toHaveAttribute('id', 'quick-photo')
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic accessible chair')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('120')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(page.locator('.quick-done h2')).toBeFocused()
    expect(await original!.evaluate((el) => el.isConnected)).toBe(true)
    await expect(page.locator('.quick-reception [role="status"]')).toHaveCount(
      1,
    )
    await page
      .getByRole('button', { name: d.quickIntake.next, exact: true })
      .click()
    expect(await original!.evaluate((el) => el.isConnected)).toBe(true)
    await expect(status).toHaveText('')
  } finally {
    await f.close()
  }
})

test('Enter in price registers once while description Enter stays a newline', async ({
  page,
}) => {
  const email = `quick-enter-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    let requests = 0
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/intake/quick') &&
        request.method() === 'POST'
      )
        requests++
    })
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic keyboard chair')
    await description.press('Enter')
    await expect(description).toHaveValue('Synthetic keyboard chair\n')
    expect(requests).toBe(0)
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    await price.fill('120')
    await price.press('Enter')
    await expect(page.locator('.quick-done h2')).toBeFocused()
    expect(requests).toBe(1)
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

test('choosing an item type with Enter does not register the item', async ({
  page,
}) => {
  const email = `quick-type-enter-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    let requests = 0
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/intake/quick') &&
        request.method() === 'POST'
      )
        requests++
    })
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic type choice')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('120')
    const type = page.getByLabel(d.quickIntake.itemType, { exact: true })
    const label = await page
      .locator('#quick-item-types option')
      .first()
      .getAttribute('value')
    expect(label).toBeTruthy()
    await type.fill(label!)
    await type.press('ArrowDown')
    await type.press('Enter')
    await type.press('Tab')
    await expect(type).toHaveValue(label!)
    expect(requests).toBe(0)
    await expect(page.locator('.quick-item')).toBeVisible()
    await expect(page.locator('.quick-done')).toHaveCount(0)
    // Some browsers keep the text input focused on a pointer button click.
    // Simulate that focus behavior without changing the click itself.
    const submit = page.getByRole('button', {
      name: d.quickIntake.submit,
      exact: true,
    })
    await submit.evaluate((button) =>
      button.addEventListener('mousedown', (event) => event.preventDefault(), {
        once: true,
      }),
    )
    await type.focus()
    await submit.click()
    await expect(page.locator('.quick-done h2')).toBeFocused()
    expect(requests).toBe(1)
  } finally {
    await f.close()
  }
})

test('an in-flight keyboard save ignores another form submission', async ({
  page,
}) => {
  const email = `quick-busy-enter-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    let requests = 0
    await page.route('**/api/intake/quick', async (route) => {
      requests++
      const response = await route.fetch()
      await held
      await route.fulfill({ response })
    })
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic busy chair')
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    await price.fill('120')
    await price.press('Enter')
    await expect(price).toBeDisabled()
    await expect.poll(() => requests).toBe(1)
    await page.keyboard.press('Enter')
    await page
      .locator('.quick-item form')
      .evaluate((form) => (form as HTMLFormElement).requestSubmit())
    expect(requests).toBe(1)
    release()
    await expect(page.locator('.quick-done h2')).toBeFocused()
    expect(requests).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    release()
    await f.close()
  }
})

test('an explicit non-pointer button activation works while the type input stays focused', async ({
  page,
}) => {
  const email = `quick-explicit-activation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic explicit activation')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('120')
    await page.getByLabel(d.quickIntake.itemType, { exact: true }).focus()
    // A DOM activation has detail=0 without being an implicit Enter submit.
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click())
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
