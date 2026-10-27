import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'

test('inventory prices align across photo, sold and editable rows in all locales', async ({
  page,
  baseURL,
}, info) => {
  const email = `price-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const prices = [11300, 20000, 15000, 25000]
  const ids: string[] = []
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || $3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify({ markdownSteps: [{ afterDays: 30, percent: 10 }] }),
      ],
    )
    for (const [index, title] of [
      'A — Plain jacket',
      'B — Photographed coat',
      'C — Sold shirt',
      'D — Sold photographed dress',
    ].entries()) {
      const item = await f.item(title)
      ids.push(item)
      await f.db.query('select set_item_price($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        item,
        prices[index],
        'Synthetic alignment fixture',
      ])
    }
    await f.commit()
    for (const item of [ids[1], ids[3]]) {
      const response = await page.request.post(
        `/api/items/${item}/photos?${new URLSearchParams({ tenantId: f.tenant, requestId: randomUUID(), photoId: randomUUID(), expected: '0', action: 'add' })}`,
        {
          headers: { origin: baseURL!, 'content-type': 'image/jpeg' },
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
    }
    await f.asActor(f.actor, () =>
      f.db.query("select record_sale($1,$2,'manual',$3,$4,'SEK',$5::jsonb)", [
        f.tenant,
        randomUUID(),
        `price-layout-${randomUUID()}`,
        new Date().toISOString(),
        JSON.stringify(
          ids
            .slice(2)
            .map((itemId, index) => ({ itemId, priceOre: prices[index + 2] })),
        ),
      ]),
    )
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
      await test.step(locale, async () => {
        const d: Dictionary = JSON.parse(
          await readFile(`messages/${locale}.json`, 'utf8'),
        )
        await page
          .context()
          .addCookies([
            { name: 'komisio-locale', value: locale, url: baseURL! },
          ])
        await page.setViewportSize({ width: 1920, height: 1000 })
        await page.goto('/intake/items?sort=title&direction=asc')
        const rows = page.locator('.inventory-row')
        await expect(rows).toHaveCount(4)
        // With no active criteria there is no filter-chip row left.
        await expect(page.locator('.inventory-filter-links')).toHaveCount(0)
        await expect(rows.locator('.inventory-price-editor')).toHaveCount(2)
        await expect(rows.locator('[data-stage="sold"]')).toHaveCount(2)
        await expect(rows.locator('[data-stage="on_sale"]')).toHaveCount(2)
        const format = new Intl.NumberFormat(
          (await page.locator('html').getAttribute('lang'))!,
          {
            style: 'currency',
            currency: 'SEK',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          },
        )
        for (let index = 0; index < 4; index++) {
          await expect(
            rows.nth(index).locator('.inventory-price-value'),
          ).toHaveText(format.format(prices[index] / 100))
          await expect(
            rows.nth(index).getByRole('button', {
              name: d.itemPhotos.preview.replace('{count}', '1'),
              exact: true,
            }),
          ).toHaveCount(index % 2)
        }
        for (const width of locale === 'sv' ? [1920, 1280, 390] : [1920]) {
          await page.setViewportSize({ width, height: 1000 })
          const geometry = await rows.evaluateAll((elements) =>
            elements.map((row) => {
              const value = row.querySelector('.inventory-price-value')!
              const range = document.createRange()
              range.selectNodeContents(value)
              return {
                right: range.getBoundingClientRect().right,
                numeric: getComputedStyle(
                  row.querySelector('.inventory-price')!,
                ).fontVariantNumeric,
                indicatorWidth: row
                  .querySelector('.inventory-indicator-cell')!
                  .getBoundingClientRect().width,
              }
            }),
          )
          expect(
            Math.max(...geometry.map((row) => row.right)) -
              Math.min(...geometry.map((row) => row.right)),
          ).toBeLessThanOrEqual(0.5)
          for (const row of geometry) {
            expect(row.numeric).toBe('tabular-nums')
            expect(row.indicatorWidth).toBeCloseTo(54, 0)
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width)
          if (width === 1920 && ['sv', 'en'].includes(locale))
            await page.screenshot({
              path: info.outputPath(`inventory-prices-${locale}.png`),
              fullPage: true,
              caret: 'initial',
            })
        }
      })
    }
  } finally {
    await f.close()
  }
})
