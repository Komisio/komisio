import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { hideableIntakeFields } from '../../lib/engine/registration'
import d from '../../messages/sv.json' with { type: 'json' }

test('store visibility controls quick and bag intake, keeps required questions and omits hidden values', async ({
  page,
}) => {
  const email = `visibility-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const slug = (
      await f.db.query('select create_item_type($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'Synthetic required brand',
        'sv',
        JSON.stringify([
          { slug: 'description', expected: false, sort: 0 },
          { slug: 'brand', expected: true, sort: 1 },
          { slug: 'size', expected: false, sort: 2 },
        ]),
      ])
    ).rows[0].create_item_type
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic visibility bag',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    for (const selector of [
      '#quick-description',
      '#quick-internal-note',
      '#quick-item-type',
      '#quick-assortment',
      '#quick-category',
      '#quick-brand',
    ])
      await expect(page.locator(selector)).toBeVisible()
    await expect(page.locator('#quick-photo')).toBeAttached()

    await page.goto('/settings?tab=vocabulary')
    const settings = page
      .locator('section')
      .filter({
        has: page.getByRole('heading', {
          name: d.registration.title,
          exact: true,
        }),
      })
      .last()
    const visibility = settings.getByRole('group', {
      name: d.registration.visibility.title,
      exact: true,
    })
    const price = visibility.getByLabel(
      d.registration.visibility.fields.price,
      { exact: true },
    )
    await expect(price).toBeChecked()
    await expect(price).toBeDisabled()
    for (const field of hideableIntakeFields)
      await visibility
        .getByLabel(d.registration.visibility.fields[field], { exact: true })
        .uncheck()
    await settings
      .getByRole('button', { name: d.registration.save, exact: true })
      .click()
    await expect(settings.getByRole('status')).toHaveText(d.registration.saved)
    await page.reload()
    await expect(
      visibility.getByLabel(d.registration.visibility.fields.photo, {
        exact: true,
      }),
    ).not.toBeChecked()

    const commands: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/intake/quick') &&
        request.method() === 'POST'
      )
        commands.push(request.postDataJSON())
    })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    for (const selector of [
      '#quick-description',
      '#quick-internal-note',
      '#quick-photo',
      '#quick-item-type',
      '#quick-assortment',
      '#quick-category',
      '#quick-brand',
      '#quick-size',
    ])
      await expect(page.locator(selector)).toHaveCount(0)
    await expect(page.locator('.quick-workspace')).toHaveCount(0)
    await page.setViewportSize({ width: 358, height: 774 })
    await expect(page.locator('#quick-price')).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('price-only-small.png'),
      fullPage: true,
    })
    await page.locator('#quick-price').fill('125')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(/I-[0-9A-F]{8}/)
    expect(commands[0].facts).toEqual({})
    for (const field of [
      'internalNote',
      'itemType',
      'assortment',
      'categoryId',
    ])
      expect(commands[0]).not.toHaveProperty(field)

    await page.goto('/settings?tab=vocabulary')
    await visibility
      .getByLabel(d.registration.visibility.fields.itemType, { exact: true })
      .check()
    await settings
      .getByRole('button', { name: d.registration.save, exact: true })
      .click()
    await expect(settings.getByRole('status')).toHaveText(d.registration.saved)
    await page.goto(`/intake/bags/${bag}/inspect`)
    await page.locator('#quick-item-type').selectOption(slug)
    await expect(page.locator('#quick-brand')).toBeVisible()
    await expect(page.locator('#quick-size')).toHaveCount(0)
    await expect(page.locator('#quick-photo')).toHaveCount(0)
    await expect(page.locator('#quick-description')).toHaveCount(0)
    await page.setViewportSize({ width: 1360, height: 900 })
    const workspace = await page.locator('.quick-workspace').boundingBox()
    const facts = await page.locator('.quick-facts').boundingBox()
    expect(Math.abs(workspace!.width - facts!.width)).toBeLessThan(2)
    const brand = await page.locator('#quick-brand').boundingBox()
    expect(Math.abs(facts!.width - brand!.width)).toBeLessThan(2)
    await page.screenshot({
      path: test.info().outputPath('required-type-desktop.png'),
      fullPage: true,
    })
    await page.locator('#quick-brand').fill('Synthetic brand')
    await page.locator('#quick-price').fill('150')
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(/I-[0-9A-F]{8}/)
    expect(commands[1].facts).toEqual({ brand: 'Synthetic brand' })
    expect(commands[1].bagId).toBe(bag)
    expect(commands[1]).not.toHaveProperty('internalNote')

    await page.goto('/settings?tab=vocabulary')
    await settings
      .getByLabel(d.registration.descriptionRequired, { exact: true })
      .check()
    const description = visibility.getByLabel(
      d.registration.visibility.fields.description,
      { exact: true },
    )
    await expect(description).toBeChecked()
    await expect(description).toBeDisabled()
    await expect(
      settings.getByText(d.registration.visibility.descriptionLocked, {
        exact: true,
      }),
    ).toBeVisible()
    await visibility.screenshot({
      path: test.info().outputPath('visibility-settings.png'),
    })
    await settings
      .getByRole('button', { name: d.registration.save, exact: true })
      .click()
    await expect(settings.getByRole('status')).toHaveText(d.registration.saved)
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(page.locator('#quick-description')).toHaveAttribute(
      'required',
      '',
    )
    await expect(page.locator('#quick-photo')).toHaveCount(0)
  } finally {
    await f.close()
  }
})
