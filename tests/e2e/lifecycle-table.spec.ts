import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
import d from '../../messages/sv.json' with { type: 'json' }

test('lifecycle table sorts before paging, clears both filters and fits every language', async ({
  page,
}, testInfo) => {
  const email = `lifecycle-table-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const ids: string[] = []
    for (let i = 0; i < 27; i++)
      ids.push(await f.item(`Coat ${String(i).padStart(2, '0')}`))
    await f.commit()
    await page.goto('/intake/lifecycle?q=Coat&stage=markdown_due')
    const rows = page.locator('.lifecycle-row')
    const footer = page.locator('.inventory-footer')
    await expect(rows).toHaveCount(25)
    await expect(footer).toContainText(
      d.items.showingRange
        .replace('{from}', '1')
        .replace('{to}', '25')
        .replace('{total}', '27'),
    )
    await expect(
      footer.getByText(d.items.previousPage, { exact: true }),
    ).toHaveAttribute('aria-disabled', 'true')
    const titleSort = page.getByRole('link', {
      name: `${d.items.item}: ${d.items.directory.sortDesc}`,
      exact: true,
    })
    await page
      .getByRole('link', {
        name: `${d.items.item}: ${d.items.directory.sortAsc}`,
        exact: true,
      })
      .click()
    await expect(rows.first()).toContainText('Coat 00')
    await titleSort.click()
    await expect(rows.first()).toContainText('Coat 26')
    await footer
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Coat 01')
    await expect(footer).toContainText(
      d.items.showingRange
        .replace('{from}', '26')
        .replace('{to}', '27')
        .replace('{total}', '27'),
    )
    await expect(
      footer.getByText(d.items.nextPage, { exact: true }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(new URL(page.url()).searchParams.get('q')).toBe('Coat')
    expect(new URL(page.url()).searchParams.get('stage')).toBe('markdown_due')
    await page
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(
      page.getByLabel(d.lifecycle.search, { exact: true }),
    ).toHaveValue('')
    await expect(
      page.getByLabel(d.lifecycle.filter, { exact: true }),
    ).toHaveValue('')
    await expect(rows).toHaveCount(25)
    // Every header is reachable and retains a server-backed sort contract.
    for (const [key, label] of [
      ['seller', d.quickIntake.seller],
      ['price', d.quickIntake.price],
      ['stage', d.items.stage],
      ['accepted', d.items.directory.registered],
      ['periodEnd', d.items.directory.periodEnd],
    ]) {
      await page
        .getByRole('link', {
          name: `${label}: ${d.items.directory.sortAsc}`,
          exact: true,
        })
        .click()
      await expect
        .poll(() => new URL(page.url()).searchParams.get('sort'))
        .toBe(key)
      await expect(page.locator('th[aria-sort="ascending"]')).toHaveText(label)
    }
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const texts: Dictionary = JSON.parse(
        readFileSync(
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
      await page.goto(`/intake/lifecycle?q=${ids[0]}#lifecycle-${ids[0]}`)
      // Reusing the same URL can be a hash-only navigation; reload the locale.
      await page.reload()
      await expect(rows).toHaveAttribute('data-open', 'true')
      await expect(
        page.getByLabel(texts.lifecycle.price, { exact: true }),
      ).toBeVisible()
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
      }
      await rows.locator('.lifecycle-expand').click()
      await expect(
        page.getByLabel(texts.lifecycle.price, { exact: true }),
      ).not.toBeVisible()
      await rows.locator('.lifecycle-expand').focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByLabel(texts.lifecycle.price, { exact: true }),
      ).toBeVisible()
      if (locale === 'sv') {
        await page.screenshot({
          path: testInfo.outputPath('lifecycle-table-desktop.png'),
          fullPage: true,
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.screenshot({
          path: testInfo.outputPath('lifecycle-table-mobile.png'),
          fullPage: true,
        })
      }
    }
  } finally {
    await f.close()
  }
})
