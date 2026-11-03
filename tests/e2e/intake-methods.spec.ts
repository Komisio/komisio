import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'
import d from '../../messages/sv.json' with { type: 'json' }

async function switchMethod(
  page: Page,
  link: Locator,
  accept: boolean,
  message: string,
) {
  const waiting = page.waitForEvent('dialog')
  const clicking = link.click()
  const dialog = await waiting
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(message)
  if (accept) await dialog.accept()
  else await dialog.dismiss()
  await clicking
}

test('switching receiving methods preserves cancelled item, receipt and seller drafts without writes', async ({
  page,
}) => {
  const email = `intake-methods-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const writes: string[] = []
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/api/')
      )
        writes.push(request.url())
    })
    await page.goto('/')
    const actions = page.getByRole('region', {
      name: d.dashboard.actions,
      exact: true,
    })
    await actions.locator('a[href="/intake/quick"]').click()
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic unsaved chair')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('150')
    const later = page
      .locator('.intake-header')
      .getByRole('link', { name: d.nav.receiveBag, exact: true })
    await switchMethod(page, later, false, d.quickIntake.leaveItem)
    await expect(description).toHaveValue('Synthetic unsaved chair')
    await expect(
      page.getByLabel(d.quickIntake.price, { exact: true }),
    ).toHaveValue('150')
    await switchMethod(page, later, true, d.quickIntake.leaveItem)
    await expect(page).toHaveURL('/intake')
    await page.goto(`/intake?seller=${f.seller}#bag-receiving`)
    const note = page
      .locator('#new-seller')
      .getByLabel(d.intake.note, { exact: true })
    await note.fill('Synthetic box for later')
    const direct = page.locator('.intake-shortcuts a[href="/intake/quick"]')
    await switchMethod(page, direct, false, d.leaveUnsaved)
    await expect(note).toHaveValue('Synthetic box for later')
    await switchMethod(page, direct, true, d.leaveUnsaved)
    await expect(page).toHaveURL('/intake/quick')
    await page.goto('/intake#new-seller')
    const name = page
      .locator('#new-seller')
      .getByLabel(d.intake.name, { exact: true })
    await name.fill('Synthetic unfinished seller')
    await switchMethod(page, direct, false, d.quickIntake.workspace.leaveSeller)
    await expect(name).toHaveValue('Synthetic unfinished seller')
    await switchMethod(page, direct, true, d.quickIntake.workspace.leaveSeller)
    await expect(page).toHaveURL('/intake/quick')
    expect(writes).toHaveLength(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from bag_receipts where tenant_id=$1',
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

test('both task entries remain readable and direct in all languages at mobile and desktop widths', async ({
  page,
  baseURL,
}, info) => {
  const email = `intake-wording-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
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
      const t: Dictionary = JSON.parse(
        await readFile(`messages/${locale}.json`, 'utf8'),
      )
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: baseURL! }])
      await page.goto('/')
      const actions = page.getByRole('region', {
        name: t.dashboard.actions,
        exact: true,
      })
      const direct = actions.locator('a[href="/intake/quick"]')
      const later = actions.locator('a[href="/intake#bag-receiving"]')
      await expect(direct).toContainText(t.quickIntake.title)
      await expect(direct).toContainText(t.intake.quickHint)
      await expect(later).toContainText(t.nav.receiveBag)
      await expect(later).toContainText(t.dashboard.receiptHint)
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(width)
        for (const link of [direct, later]) {
          await expect(link).toBeVisible()
          expect(
            await link.evaluate((el) => el.scrollWidth <= el.clientWidth),
          ).toBe(true)
        }
      }
      const mobile = page.locator('.mobile-nav a[href="/intake/quick"]')
      await expect(mobile).toHaveText(t.nav.quickShort)
      expect((await mobile.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await direct.click()
      await expect(page).toHaveURL('/intake/quick')
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: t.quickIntake.title,
          exact: true,
        }),
      ).toBeVisible()
      await expect(page.locator('.intake-method-hint')).toHaveText(
        t.intake.quickHint,
      )
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(width)
      }
      if (locale === 'sv')
        await page.screenshot({
          path: info.outputPath('register-now-mobile.png'),
          fullPage: true,
          caret: 'initial',
        })
      await page.locator('.intake-header a[href="/intake"]').click()
      await expect(page).toHaveURL('/intake')
      await expect(
        page.getByRole('tab', { name: t.nav.receiveBag, exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(
        page.locator('#bag-receiving .intake-method-hint'),
      ).toHaveText(t.dashboard.receiptHint)
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(width)
      }
      if (locale === 'sv')
        await page.screenshot({
          path: info.outputPath('receive-later-desktop.png'),
          fullPage: true,
          caret: 'initial',
        })
    }
  } finally {
    await f.close()
  }
})
