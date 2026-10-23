import { test, expect, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
const languageTags = {
  sv: 'sv-SE',
  en: 'en-GB',
  no: 'nb-NO',
  dk: 'da-DK',
  fi: 'fi-FI',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
}

async function assertControlsFit(form: Locator) {
  const boxes = await form
    .locator('input:not([type="hidden"]),select,button')
    .evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect()
        const parent = el.closest('form')!.getBoundingClientRect()
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          height: r.height,
          parentRight: parent.right,
          parentLeft: parent.left,
        }
      }),
    )
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(box.parentLeft - 1)
    expect(box.right).toBeLessThanOrEqual(box.parentRight + 1)
    for (const other of boxes.filter((candidate) => candidate !== box))
      expect(
        box.right <= other.x + 1 ||
          other.right <= box.x + 1 ||
          box.bottom <= other.y + 1 ||
          other.bottom <= box.y + 1,
        'filter controls must not overlap',
      ).toBe(true)
  }
}

for (const [locale, tag] of Object.entries(languageTags)) {
  test(`stock sales fit the available width and format facts (${locale})`, async ({
    page,
    baseURL,
  }, info) => {
    const email = `stock-layout-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const d: Dictionary = JSON.parse(
      await readFile(`messages/${locale}.json`, 'utf8'),
    )
    try {
      const item = await f.item('Synthetic layout jacket')
      await f.db.query(
        "select record_sale($1,$2,'manual',$3,'2026-10-12T10:00:00Z','SEK',$4::jsonb)",
        [
          f.tenant,
          randomUUID(),
          `stock-layout-${randomUUID()}`,
          JSON.stringify([{ itemId: item, priceOre: 108000 }]),
        ],
      )
      await f.commit()
      await page
        .context()
        .addCookies([{ name: 'komisio-locale', value: locale, url: baseURL! }])
      await page.setViewportSize({ width: 768, height: 1024 })
      await page.goto('/intake/stock?from=2026-10-01&to=2026-10-31#stock-sales')
      await expect(
        page.getByRole('tab', { name: d.stock.tabs.sales, exact: true }),
      ).toBeEnabled()
      const panel = page.locator('#stock-sales')
      const filters = page.locator('.stock-period')
      for (const viewport of [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 1000 },
        { width: 320, height: 800 },
      ]) {
        await page.setViewportSize(viewport)
        for (const expanded of viewport.width > 700 ? [true, false] : [false]) {
          const toggle = page.locator('.sidebar .sidebar-toggle')
          if (
            viewport.width > 700 &&
            (await toggle.getAttribute('aria-expanded')) !== String(expanded)
          )
            await toggle.click()
          await expect
            .poll(() =>
              page.evaluate(() => document.documentElement.scrollWidth),
            )
            .toBeLessThanOrEqual(viewport.width)
          await assertControlsFit(filters)
          await expect(
            page.getByRole('button', { name: d.economy.show, exact: true }),
          ).toHaveCount(1)
          const expectedMoney = new Intl.NumberFormat(tag, {
            style: 'currency',
            currency: 'SEK',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(1080)
          await expect(panel.locator('.stock-sales-metrics')).toContainText(
            expectedMoney,
          )
          for (const value of await panel
            .locator('.stock-metrics dd:visible')
            .all()) {
            const geometry = await value.evaluate((el) => {
              const range = document.createRange()
              range.selectNodeContents(el)
              const rectangles = [...range.getClientRects()]
              const r = el.getBoundingClientRect()
              return {
                lines: new Set(rectangles.map((rect) => Math.round(rect.top)))
                  .size,
                fits: rectangles.every(
                  (rect) =>
                    rect.right <= r.right + 1 && rect.left >= r.left - 1,
                ),
              }
            })
            expect(geometry.lines).toBe(1)
            expect(geometry.fits).toBe(true)
          }
          const details = panel.locator('.stock-details')
          if ((await details.getAttribute('open')) === null)
            await details.locator('summary').click()
          const wrap = details.locator('.stock-table-wrap')
          expect(
            await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true)
          const row = details.locator('tbody tr').first()
          await expect(row.locator('td')).toHaveCount(6)
          for (const cell of await row.locator('td').all()) {
            const geometry = await cell.evaluate((el) => {
              const range = document.createRange()
              range.selectNodeContents(el)
              const r = el.getBoundingClientRect()
              const text = [...range.getClientRects()]
              return {
                lines: new Set(text.map((rect) => Math.round(rect.top))).size,
                fits: text.every(
                  (rect) =>
                    rect.right <= r.right + 1 && rect.left >= r.left - 1,
                ),
              }
            })
            expect(geometry.lines).toBe(1)
            expect(geometry.fits).toBe(true)
          }
          if (locale === 'sv' && viewport.width === 768 && expanded)
            await page.screenshot({
              path: info.outputPath('stock-sales-ipad.png'),
              fullPage: true,
            })
        }
      }
      const period = new Intl.DateTimeFormat(tag, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).formatRange(
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-31T00:00:00Z'),
      )
      await expect(panel).toContainText(period)
      await page
        .getByLabel(d.items.ownership, { exact: true })
        .selectOption('store')
      await page.getByLabel(d.economy.from, { exact: true }).fill('2026-09-01')
      await page.getByLabel(d.economy.to, { exact: true }).fill('2026-09-30')
      await filters
        .getByRole('button', { name: d.economy.show, exact: true })
        .click()
      await expect(page).toHaveURL(/ownership=store/)
      expect(new URL(page.url()).searchParams.get('from')).toBe('2026-09-01')
      expect(new URL(page.url()).searchParams.get('to')).toBe('2026-09-30')
      await expect(
        page.getByRole('tab', { name: d.stock.tabs.sales, exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(panel.locator('.stock-sales-metrics dd').first()).toHaveText(
        '0',
      )
    } finally {
      await f.close()
    }
  })
}
