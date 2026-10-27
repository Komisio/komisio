import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function fixture(page: Page) {
  const email = `scan-focus-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  return p2Fixture(email)
}

async function readyField(page: Page, field: Locator) {
  await expect(field).toBeVisible()
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches,
  )
  const button = page.getByRole('button', { name: d.scanFocus, exact: true })
  if (touch) {
    await expect(button).toBeEnabled()
    await expect(field).not.toBeFocused()
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width)
    if ((await field.getAttribute('id')) === 'seller-search') {
      await expect(
        page
          .locator('.intake-find-seller')
          .getByRole('button', { name: d.intake.searchButton, exact: true }),
      ).toHaveCount(0)
    }
    if (test.info().title.startsWith('all five'))
      await page.screenshot({
        path: test.info().outputPath(`${await field.getAttribute('id')}.png`),
        fullPage: true,
      })
    await button.tap()
  } else await expect(button).not.toBeVisible()
  await expect(field).toBeFocused()
  return touch
}

test('all five scan-first workspaces offer appropriate initial focus', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    await f.commit()
    await page.goto('/intake/open')
    await readyField(page, page.locator('#open-ref'))
    await page.goto('/intake/quick')
    await readyField(page, page.locator('#quick-seller-search'))
    await page.goto('/intake')
    await readyField(page, page.locator('#seller-search'))
    await page.goto('/intake/sales#manual')
    await page
      .getByRole('tab', { name: d.sales.manualTab, exact: true })
      .click()
    await readyField(page, page.locator('#sale-search'))
    await page.goto('/intake/stocktake')
    await page
      .getByRole('button', { name: d.stocktake.start, exact: true })
      .click()
    await readyField(page, page.locator('#stocktake-scan'))
  } finally {
    await f.close()
  }
})

test('manual sale search and confirmed sale restore focus without auto-adding or auto-selling', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    const item = await f.item('Synthetic scan-focus lamp')
    await f.commit()
    await page.goto('/intake/sales')
    await page
      .getByRole('tab', { name: d.sales.manualTab, exact: true })
      .click()
    const search = page.locator('#sale-search')
    await readyField(page, search)
    // A keyboard wedge sends ordinary keystrokes and Enter, without a click.
    await page.keyboard.type(`I-${item.slice(0, 8).toUpperCase()}`)
    await page.keyboard.press('Enter')
    const add = page.getByRole('button', { name: d.sales.add, exact: true })
    await expect(add).toBeVisible()
    await expect(search).toBeFocused()
    await expect(page.locator('.sale-cart li')).toHaveCount(0)
    await add.click()
    await expect(page.locator('.sale-cart li')).toHaveCount(1)
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sales where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(
      page.getByText(d.sales.recorded, { exact: false }),
    ).toBeVisible()
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sales where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})

test('stocktake scan clears and restores focus for the next keyboard scan', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    const item = await f.item('Synthetic scan-focus coat')
    await f.commit()
    await page.goto('/intake/stocktake')
    await page
      .getByRole('button', { name: d.stocktake.start, exact: true })
      .click()
    const scan = page.locator('#stocktake-scan')
    await readyField(page, scan)
    await page.keyboard.type(`I-${item.slice(0, 8).toUpperCase()}`)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText(d.stocktake.scanned)
    await expect(scan).toHaveValue('')
    await expect(scan).toBeFocused()
    await page.keyboard.type(`I-${item.slice(0, 8).toUpperCase()}`)
    await page.keyboard.press('Enter')
    await expect(scan).toHaveValue('')
    await expect(scan).toBeFocused()
  } finally {
    await f.close()
  }
})

test('quick reception keeps completion announced and prepares the next item', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    await f.commit()
    await page.goto('/intake/quick')
    await readyField(page, page.locator('#quick-seller-search'))
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.locator('#quick-description')
    await readyField(page, description)
    await page.keyboard.type('Synthetic scan-focus item')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('120')
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(page.locator('.quick-done h2')).toBeFocused()
    await page
      .getByRole('button', { name: d.quickIntake.next, exact: true })
      .click()
    await expect(description).toHaveValue('')
    await expect(description).toBeFocused()
  } finally {
    await f.close()
  }
})

test('reference lookup preserves navigation and is ready again on return', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    const item = await f.item('Synthetic scan-focus reference')
    await f.commit()
    await page.goto('/intake/open')
    const input = page.locator('#open-ref')
    const touch = await readyField(page, input)
    await page.keyboard.type(`I-${item.slice(0, 8).toUpperCase()}`)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`/intake/items/${item}`)
    await page.goBack()
    await expect(page).toHaveURL('/intake/open')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('')
    if (touch)
      await page.getByRole('button', { name: d.scanFocus, exact: true }).tap()
    await expect(input).toBeFocused()
  } finally {
    await f.close()
  }
})

test('tab arrows keep keyboard focus while pointer selection prepares the input', async ({
  page,
}) => {
  const f = await fixture(page)
  try {
    await f.commit()
    await page.goto('/intake/sales')
    const tabs = page.getByRole('tab')
    await expect(tabs.first()).toBeEnabled()
    await tabs.first().focus()
    await page.keyboard.press('ArrowRight')
    const manual = page.getByRole('tab', {
      name: d.sales.manualTab,
      exact: true,
    })
    await expect(manual).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#sale-search')).toBeVisible()
    await expect(manual).toBeFocused()
    await tabs.first().click()
    await manual.click()
    await readyField(page, page.locator('#sale-search'))
  } finally {
    await f.close()
  }
})

test('search response cannot steal focus from another field or an open dialog', async ({
  page,
}) => {
  const f = await fixture(page)
  let release = () => {}
  try {
    await f.item('Synthetic delayed search')
    await f.commit()
    await page.goto('/intake/sales')
    await page
      .getByRole('tab', { name: d.sales.manualTab, exact: true })
      .click()
    const search = page.locator('#sale-search')
    await readyField(page, search)
    for (const modal of [false, true]) {
      let arrived = false
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(
        '**/api/sales/items?*',
        async (route) => {
          const response = await route.fetch()
          arrived = true
          await held
          await route.fulfill({ response })
        },
        { times: 1 },
      )
      await search.fill('Synthetic delayed search')
      await search.press('Enter')
      await expect.poll(() => arrived).toBe(true)
      // Native controls exercise the shared helper independently of a particular
      // drawer implementation; a dialog still owns focus when it opens mid-flight.
      await page.evaluate((modal) => {
        const host = document.createElement(modal ? 'dialog' : 'div')
        host.id = 'scan-focus-other'
        const input = document.createElement('input')
        input.setAttribute('aria-label', 'Synthetic other editor')
        host.append(input)
        document.body.append(host)
        if (host instanceof HTMLDialogElement) host.showModal()
        input.focus()
      }, modal)
      const other = page.getByLabel('Synthetic other editor')
      await other.fill('Keep my focus')
      release()
      await expect(
        page.locator('.sale-search-results button').first(),
      ).toBeVisible()
      await expect(other).toBeFocused()
      await expect(other).toHaveValue('Keep my focus')
      if (modal) {
        await page
          .locator('#scan-focus-other')
          .evaluate((dialog) => (dialog as HTMLDialogElement).close())
        await expect(search).toBeFocused()
      }
      await page.evaluate(() =>
        document.getElementById('scan-focus-other')!.remove(),
      )
    }
  } finally {
    release()
    await f.close()
  }
})
