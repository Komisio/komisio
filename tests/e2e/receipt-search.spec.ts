import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import type { Dictionary } from '../../lib/i18n'

test('receipt search finds older sales beyond the latest fifty and preserves the exact filter through details', async ({
  page,
}) => {
  const email = `receipt-search-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const old = randomUUID()
  const reference = 'SYNTHETIC OLD / A&B 0051'
  try {
    for (let index = 0; index < 51; index++) {
      const item = await f.item(`Synthetic receipt search ${index}`)
      await f.db.query(
        "select record_sale($1,$2,'manual',$3,$4,'SEK',$5::jsonb)",
        [
          f.tenant,
          index === 0 ? old : randomUUID(),
          index === 0 ? reference : `SYNTHETIC-RECENT-${index}`,
          index === 0 ? '2020-01-01T10:00:00Z' : '2021-01-01T10:00:00Z',
          JSON.stringify([{ itemId: item, priceOre: 20000 }]),
        ],
      )
    }
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/sales')
    await expect(page.locator('.sales-register-row')).toHaveCount(50)
    await expect(page.locator(`a[href="/intake/sales/${old}"]`)).toHaveCount(0)
    const search = page.getByRole('search', { name: d.sales.findReceipt })
    await search.getByLabel(d.sales.reference, { exact: true }).fill(reference)
    await search
      .getByLabel(d.sales.source, { exact: true })
      .selectOption('manual')
    await search
      .getByRole('button', { name: d.sales.findReceipt, exact: true })
      .click()
    const filtered = page.url()
    await expect(page.locator('.sales-register-row')).toHaveCount(1)
    const row = page.locator('.sales-register-row')
    await expect(row).toContainText('200.00 SEK')
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/intake/sales/${old}\\?`))
    await page
      .getByRole('link', { name: d.sales.backToList, exact: true })
      .click()
    await expect(page).toHaveURL(filtered)
    await expect(
      search.getByLabel(d.sales.reference, { exact: true }),
    ).toHaveValue(reference)
    await expect(
      search.getByLabel(d.sales.source, { exact: true }),
    ).toHaveValue('manual')
    await search
      .getByLabel(d.sales.reference, { exact: true })
      .fill('SYNTHETIC OLD')
    await search
      .getByRole('button', { name: d.sales.findReceipt, exact: true })
      .click()
    await expect(page.locator('.sales-register-row')).toHaveCount(0)
    await expect(
      page.getByText(d.sales.noReceipts, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(d.sales.empty, { exact: true })).toHaveCount(0)
    await search
      .getByRole('link', { name: d.sales.showLatest, exact: true })
      .click()
    await expect(page.locator('.sales-register-row')).toHaveCount(50)
    await expect(
      search.getByLabel(d.sales.reference, { exact: true }),
    ).toHaveValue('')
    await expect(
      search.getByLabel(d.sales.source, { exact: true }),
    ).toHaveValue('')
    await search
      .getByLabel(d.sales.source, { exact: true })
      .selectOption('shopify')
    await search
      .getByRole('button', { name: d.sales.findReceipt, exact: true })
      .click()
    await expect(page.locator('.sales-register-row')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from sales where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(51)
  } finally {
    await f.close()
  }
})

test('receipt filters remain readable at 320px in all supported languages', async ({
  page,
}) => {
  const email = `receipt-search-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const copy: Dictionary = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page
        .context()
        .addCookies([
          {
            name: 'komisio-locale',
            value: locale,
            url: 'http://127.0.0.1:3000',
          },
        ])
      await page.goto(
        `/intake/sales?reference=SYNTHETIC&provider=manual&language-check=${locale}`,
      )
      const search = page.getByRole('search', { name: copy.sales.findReceipt })
      await expect(
        search.getByLabel(copy.sales.reference, { exact: true }),
      ).toHaveValue('SYNTHETIC')
      await expect(
        search.getByRole('link', { name: copy.sales.showLatest, exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText(copy.sales.noReceipts, { exact: true }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (locale === 'sv')
        await page.screenshot({
          path: 'private/receipt-search-mobile.png',
          fullPage: true,
        })
    }
  } finally {
    await f.close()
  }
})
