import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import all from '../../messages/sv.json' with { type: 'json' }
const d = all.sellersList

test('staff can browse every matching seller on a phone and search from later pages', async ({
  page,
}, testInfo) => {
  const email = `seller-pages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 53; i++)
      await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        `Paging contact ${String(i).padStart(2, '0')}`,
        `contact-${randomUUID()}@example.test`,
        '0701234567',
      ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/sellers?q=Paging')
    const rows = page.locator('.seller-directory-table tbody tr')
    await expect(rows).toHaveCount(25)
    const links = () => rows.locator('td:first-child a')
    const seen = new Set(
      await links().evaluateAll((nodes) =>
        nodes.map((a) => a.getAttribute('href')),
      ),
    )
    for (const currentPage of [2, 3]) {
      await page.getByRole('link', { name: d.nextPage, exact: true }).click()
      await expect(
        page.getByText(
          d.pageOf
            .replace('{page}', String(currentPage))
            .replace('{pages}', '3'),
          { exact: true },
        ),
      ).toBeVisible()
      await expect(rows).toHaveCount(currentPage === 2 ? 25 : 3)
      expect(new URL(page.url()).searchParams.get('q')).toBe('Paging')
      for (const href of await links().evaluateAll((nodes) =>
        nodes.map((a) => a.getAttribute('href')),
      )) {
        expect(seen.has(href)).toBe(false)
        seen.add(href)
      }
    }
    expect(seen.size).toBe(53)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await expect(
      page.getByRole('link', { name: d.nextPage, exact: true }),
    ).toHaveCount(0)
    await page.screenshot({
      caret: 'initial',
      path: testInfo.outputPath('sellers-mobile.png'),
      fullPage: true,
    })
    await page.getByLabel(d.search, { exact: true }).fill('Paging contact 52')
    await page
      .getByRole('button', { name: d.searchButton, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Paging contact 52')
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page.getByRole('link', { name: d.clear, exact: true }).click()
    await expect(rows).toHaveCount(25)
    await expect(page.getByLabel(d.search, { exact: true })).toHaveValue('')
    await page.goto('/intake/sellers?q=Paging&page=999')
    await expect(page).toHaveURL(/page=3/)
    await expect(rows).toHaveCount(3)
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(
      page.getByRole('heading', { name: d.title, exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel(d.search, { exact: true })).toHaveValue(
      'Paging',
    )
    await page.screenshot({
      caret: 'initial',
      path: testInfo.outputPath('sellers-desktop.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
