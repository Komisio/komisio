import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('staff can reach all matching items and retain filters on a phone', async ({
  page,
}, testInfo) => {
  const email = `item-pages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 53; i++)
      await f.item(`Paging coat ${String(i).padStart(2, '0')}`)
    await f.item('Unrelated item')
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/items?q=Paging&stage=markdown_due')
    const rows = page.locator('.intake-list li')
    await expect(rows).toHaveCount(25)
    await expect
      .poll(
        async () =>
          (await page.getByLabel(d.items.search, { exact: true }).boundingBox())
            ?.width ?? 0,
      )
      .toBeGreaterThan(180)
    const seen = new Set(
      await rows
        .locator('a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    )
    const next = () =>
      page.getByRole('link', { name: d.items.nextPage, exact: true })
    let currentPage = 1
    for (const expectedCount of [25, 3]) {
      await next().click()
      currentPage += 1
      await expect(
        page.getByText(
          d.items.pageOf
            .replace('{page}', String(currentPage))
            .replace('{pages}', '3'),
          { exact: true },
        ),
      ).toBeVisible()
      await expect(rows).toHaveCount(expectedCount)
      expect(new URL(page.url()).searchParams.get('q')).toBe('Paging')
      expect(new URL(page.url()).searchParams.get('stage')).toBe('markdown_due')
      for (const href of await rows
        .locator('a')
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute('href')),
        )) {
        expect(seen.has(href)).toBe(false)
        seen.add(href)
      }
    }
    expect(seen.size).toBe(53)
    await expect(next()).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const previous = page.getByRole('link', {
      name: d.items.previousPage,
      exact: true,
    })
    expect((await previous.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({
      caret: 'initial',
      path: testInfo.outputPath('items-mobile.png'),
      fullPage: true,
    })
    await page.getByLabel(d.items.search, { exact: true }).fill('Unrelated')
    await page
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(rows).toHaveCount(25)
    await page.goto('/intake/items?q=Paging&stage=markdown_due&page=999')
    await expect(rows).toHaveCount(3)
    expect(new URL(page.url()).searchParams.get('page')).toBe('3')
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(
      page.getByRole('heading', { name: d.items.title, exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel(d.items.search, { exact: true })).toHaveValue(
      'Paging',
    )
    await page.screenshot({
      caret: 'initial',
      path: testInfo.outputPath('items-desktop.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
