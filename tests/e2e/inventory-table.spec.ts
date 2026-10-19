import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import { readFile } from 'node:fs/promises'

test('inventory searches live without losing typing, filters or history', async ({
  page,
}) => {
  const email = `live-items-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Blue coat')
    await f.item('Green coat')
    await f.commit()
    await page.goto('/intake/items?sort=title&direction=asc')
    const search = page.getByLabel(d.items.search, { exact: true })
    const rows = page.locator('.inventory-row')
    await expect(
      page.getByRole('button', { name: d.items.searchButton, exact: true }),
    ).toHaveCount(0)
    await expect(rows).toHaveCount(2)
    // Delay the first response while the user continues typing another query.
    await page.route('**/intake/items?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('q') === 'Blue')
        await new Promise((resolve) => setTimeout(resolve, 700))
      await route.continue()
    })
    await search.fill('Blue')
    await search.press('Enter')
    await search.fill('Green')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Green coat')
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('Green')
    await page.unroute('**/intake/items?*')
    expect(new URL(page.url()).searchParams.get('sort')).toBe('title')
    await page.locator('.inventory-advanced summary').click()
    const category = page.getByLabel(d.quickIntake.category, { exact: true })
    await category.fill('Jackets')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('category'))
      .toBe('Jackets')
    await expect(category).toBeFocused()
    await expect(page.locator('.inventory-advanced')).toHaveAttribute(
      'open',
      '',
    )
    await page
      .getByLabel(d.items.directory.photo, { exact: true })
      .selectOption('yes')
    await expect(rows).toHaveCount(0)
    await page
      .getByLabel(d.items.directory.photo, { exact: true })
      .selectOption('')
    await expect(rows).toHaveCount(1)
    const date = page.getByLabel(d.items.directory.acceptedFrom, {
      exact: true,
    })
    await date.fill('2099-01-01')
    await expect(rows).toHaveCount(0)
    await date.fill('')
    await expect(rows).toHaveCount(1)
    await page
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    await expect(search).toHaveValue('')
    await expect(category).toHaveValue('')
    await page.goBack()
    await expect(search).toHaveValue('Green')
    await expect(category).toHaveValue('Jackets')
    await expect(rows).toHaveCount(1)
    await page.goto('/intake/items?paypal=failed')
    await expect(
      page.getByLabel(d.itemSync.system, { exact: true }),
    ).toHaveValue('paypal')
    await expect(
      page.getByLabel(d.itemSync.title, { exact: true }),
    ).toHaveValue('failed')
  } finally {
    await f.close()
  }
})

test('inventory sorts all results, combines advanced filters and previews default photos without leaving the table', async ({
  page,
}) => {
  const email = `inventory-table-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids: string[] = []
    for (let n = 0; n < 57; n++) {
      const item = await f.item(
        n === 0
          ? 'Blå linneskjorta med lång beskrivning som ska hållas på en enda rad i tabellen'
          : `${n % 2 ? 'Ullkappa' : 'Blå linneskjorta'} ${String(n).padStart(2, '0')}`,
      )
      ids.push(item)
      await f.db.query('select set_item_price($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        item,
        1000 + n * 100,
        'Synthetic table test',
      ])
    }
    await f.commit()
    // Upload through the same authorized route as the gallery; no storage bypass.
    const photo = randomUUID()
    const response = await page.request.post(
      `/api/items/${ids[0]}/photos?${new URLSearchParams({
        tenantId: f.tenant,
        requestId: randomUUID(),
        photoId: photo,
        expected: '0',
        action: 'add',
      })}`,
      {
        headers: {
          origin: new URL(page.url()).origin,
          'content-type': 'image/jpeg',
        },
        data: await sharp({
          create: {
            width: 120,
            height: 160,
            channels: 3,
            background: '#6495ad',
          },
        })
          .jpeg()
          .toBuffer(),
      },
    )
    expect(response.ok()).toBe(true)
    let imageRequests = 0
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/photos?'))
        imageRequests++
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/intake/items?sort=price&direction=asc')
    const rows = page.locator('.inventory-row')
    await expect(rows).toHaveCount(25)
    await expect(rows.first().locator('.inventory-price')).toHaveText(
      '10.00 SEK',
    )
    await expect(page.locator('.inventory-advanced')).not.toHaveAttribute(
      'open',
      '',
    )
    expect(imageRequests).toBe(0)
    await expect(rows.first()).toBeVisible()
    await expect
      .poll(async () => (await rows.first().boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(50)
    const photoButton = rows.first().getByRole('button', {
      name: d.itemPhotos.preview.replace('{count}', '1'),
    })
    await photoButton.hover()
    const preview = page.getByRole('tooltip')
    await expect(preview.locator('img')).toHaveAttribute(
      'src',
      new RegExp(photo),
    )
    await expect
      .poll(() =>
        preview
          .locator('img')
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)
    await page.screenshot({
      path: 'private/inventory-table-photo-desktop.png',
      fullPage: true,
    })
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    const ownership = rows.first().getByRole('button', {
      name: d.items.ownershipKinds.consignment,
      exact: true,
    })
    await ownership.focus()
    await expect(preview).toHaveText(d.items.ownershipKinds.consignment)
    await page.keyboard.press('Escape')
    const markdown = rows
      .first()
      .getByRole('button', { name: /Prissänkning väntar sedan/ })
    await markdown.focus()
    await expect(preview).toContainText(/\d{4}/)
    await page.keyboard.press('Escape')
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(rows.first().locator('.inventory-price')).toHaveText(
      '35.00 SEK',
    )
    await page
      .getByRole('link', {
        name: `${d.quickIntake.price}: ${d.items.directory.sortDesc}`,
        exact: true,
      })
      .click()
    await expect(rows.first().locator('.inventory-price')).toHaveText(
      '66.00 SEK',
    )
    await expect
      .poll(() => new URL(page.url()).searchParams.has('page'))
      .toBe(false)
    await expect(page.locator('th[aria-sort="descending"]')).toContainText(
      d.quickIntake.price,
    )
    await page.locator('.inventory-advanced summary').click()
    await page
      .getByLabel(d.items.directory.minPrice, { exact: true })
      .fill('30')
    await page
      .getByLabel(d.items.directory.maxPrice, { exact: true })
      .fill('35')
    await page
      .getByLabel(d.quickIntake.seller, { exact: true })
      .selectOption(f.seller)
    await page
      .getByLabel(d.quickIntake.category, { exact: true })
      .fill('Jackets')
    await page
      .getByLabel(d.items.ownership, { exact: true })
      .selectOption('consignment')
    await expect(rows).toHaveCount(6)
    await expect(rows.first().locator('.inventory-price')).toHaveText(
      '35.00 SEK',
    )
    await expect(page.locator('.inventory-advanced')).toHaveAttribute(
      'open',
      '',
    )
    await page.screenshot({
      path: 'private/inventory-table-filters-desktop.png',
      fullPage: true,
    })
    await page
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(rows).toHaveCount(25)
    await page.goto('/intake/items?photo=yes')
    await expect(rows).toHaveCount(1)
    await page.setViewportSize({ width: 320, height: 820 })
    await rows
      .getByRole('button', {
        name: d.itemPhotos.preview.replace('{count}', '1'),
      })
      .click()
    await expect(preview.locator('img')).toBeVisible()
    const box = (await preview.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/inventory-table-mobile.png',
      fullPage: true,
    })
    await page.goto('/intake/items?minPrice=50&maxPrice=20')
    await expect(
      page.locator('.inventory-panel').getByRole('alert'),
    ).toHaveText(d.items.directory.invalid)
    await expect(rows).toHaveCount(0)
    await page.goto('/intake/items?minPrice=wrong&maxPrice=20')
    await expect(
      page.locator('.inventory-panel').getByRole('alert'),
    ).toHaveText(d.items.directory.invalid)
    await page.goto('/intake/items?photo=yes&q=missing')
    await expect(
      page.getByText(d.items.noMatches, { exact: true }),
    ).toBeVisible()
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const translated = JSON.parse(
        await readFile(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto('/intake/items?photo=yes')
        await expect(
          page.getByRole('heading', {
            name: translated.items.title,
            exact: true,
          }),
        ).toBeVisible()
        await page.locator('.inventory-advanced summary').click()
        await expect(rows.first()).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        if (locale === 'de')
          await page.screenshot({
            path: `private/inventory-table-de-${width}.png`,
            fullPage: true,
          })
      }
    }
  } finally {
    await f.close()
  }
})
