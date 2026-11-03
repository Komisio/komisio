import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'
import d from '../../messages/sv.json' with { type: 'json' }

test('item titles are real links with list context and a separate visible edit control', async ({
  page,
}, info) => {
  const email = `item-actions-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic link jacket')
    await f.commit()
    const listing = '/intake/items?q=Synthetic&sort=title&direction=desc&page=1'
    await page.goto(listing)
    const row = page.locator(`#inventory-item-${item}`)
    const name = row.getByRole('link', {
      name: `${d.inventoryWorkspace.open}: Synthetic link jacket`,
      exact: true,
    })
    const edit = row.getByRole('button', {
      name: `${d.itemWorkflow.editRow} ${d.items.item}: Synthetic link jacket`,
      exact: true,
    })
    await expect(name).toHaveText('Synthetic link jacket')
    await expect(edit).toBeVisible()
    expect(
      await edit
        .locator('svg')
        .evaluate((el) => Number(getComputedStyle(el).opacity)),
    ).toBeGreaterThan(0)
    const href = await name.getAttribute('href')
    expect(new URL(href!, page.url()).searchParams.get('returnTo')).toBe(
      `${listing}#inventory-item-${item}`,
    )
    const opened = page.context().waitForEvent('page')
    await name.click({ modifiers: ['Control'] })
    const other = await opened
    await other.waitForURL(new URL(href!, page.url()).href)
    await expect(page).toHaveURL(new URL(listing, page.url()).href)
    await other.close()
    await name.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new URL(href!, page.url()).href)
    await page
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await expect(page).toHaveURL(
      new URL(`${listing}#inventory-item-${item}`, page.url()).href,
    )
    await edit.focus()
    await page.keyboard.press('Enter')
    await row
      .getByRole('textbox', { name: d.items.item, exact: true })
      .fill('Not saved')
    await page.keyboard.press('Escape')
    await expect(edit).toBeFocused()
    await expect(name).toHaveText('Synthetic link jacket')
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const linkBox = (await name.boundingBox())!,
        editBox = (await edit.boundingBox())!
      expect(linkBox.width).toBeGreaterThan(40)
      expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(editBox.x + 1)
      expect(editBox.width).toBeGreaterThanOrEqual(32)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)
      await page.screenshot({
        path: info.outputPath(`item-actions-${width}.png`),
        fullPage: true,
        caret: 'initial',
      })
    }
    // Keep a synthetic owner while testing the signed-in user's read-only role.
    const owner = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `${owner}@example.test`],
    )
    await f.db.query(
      "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
      [f.tenant, owner],
    )
    await f.db.query(
      "update tenant_members set role='readonly' where tenant_id=$1 and user_id=$2",
      [f.tenant, f.actor],
    )
    await page.reload()
    await expect(name).toBeVisible()
    await expect(row.locator('.inventory-title-edit')).toHaveCount(0)
    await expect(row.locator('.inventory-price-editor')).toHaveCount(0)
    await name.click()
    await expect(page.locator('.item-detail-change-price')).toHaveCount(0)
  } finally {
    await f.close()
  }
})

test('detail price changes replay exactly once and refuse stale prices', async ({
  page,
}, info) => {
  const email = `detail-price-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic price jacket')
    const sold = await f.item('Synthetic sold jacket')
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,$4,'SEK',$5::jsonb)",
      [
        f.tenant,
        randomUUID(),
        `detail-price-${randomUUID()}`,
        new Date().toISOString(),
        JSON.stringify([{ itemId: sold, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    await page.goto(`/intake/items/${item}`)
    const change = page.getByRole('button', {
      name: `${d.priceEdit.title}: Synthetic price jacket`,
      exact: true,
    })
    await expect(change).toHaveText(d.priceEdit.title)
    await change.click()
    const dialog = page.getByRole('dialog', {
      name: d.priceEdit.title,
      exact: true,
    })
    await dialog
      .getByLabel(`${d.lifecycle.price} (SEK)`, { exact: true })
      .fill('149,95')
    const commands: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'setItemPrice') return route.continue()
      commands.push(command)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (commands.length === 1) return route.abort('failed')
      return route.fulfill({ response })
    })
    await dialog
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: d.cancel, exact: true }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.item-detail-price strong')).toHaveText(
      '149.95 SEK',
    )
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from item_events where item_id=$1 and kind='price_set' and detail->>'priceOre'='14995'",
          [item],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.unrouteAll({ behavior: 'wait' })
    await change.click()
    await f.asActor(f.actor, () =>
      f.db.query('select set_item_price($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        item,
        14000,
        'Synthetic concurrent change',
      ]),
    )
    await dialog
      .getByLabel(`${d.lifecycle.price} (SEK)`, { exact: true })
      .fill('125')
    await dialog
      .getByRole('button', { name: d.itemWorkflow.save, exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await dialog
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(page.locator('.item-detail-price strong')).toHaveText(
      '140.00 SEK',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: info.outputPath('detail-price-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
    await page.goto(`/intake/items/${sold}`)
    await expect(page.locator('.item-detail-change-price')).toHaveCount(0)
  } finally {
    await f.close()
  }
})

test('detail price controls fit all eight languages and return focus after cancellation', async ({
  page,
  baseURL,
}) => {
  const email = `detail-locales-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic multilingual item')
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of [
      'sv',
      'en',
      'no',
      'dk',
      'fi',
      'de',
      'es',
      'it',
    ] as Locale[]) {
      const text: Dictionary = JSON.parse(
        await readFile(`messages/${locale}.json`, 'utf8'),
      )
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: baseURL! }])
      await page.goto(`/intake/items/${item}`)
      const change = page.locator('.item-detail-change-price')
      await expect(change).toHaveText(text.priceEdit.title)
      await expect(change).toBeVisible()
      await expect(change).toBeEnabled()
      await expect
        .poll(async () => (await change.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      await expect(change).toBeEnabled()
      await change.focus()
      await expect(change).toBeFocused()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', {
        name: text.priceEdit.title,
        exact: true,
      })
      await expect(dialog).toBeVisible()
      await dialog
        .getByRole('button', { name: text.cancel, exact: true })
        .click()
      await expect(change).toBeFocused()
    }
  } finally {
    await f.close()
  }
})
