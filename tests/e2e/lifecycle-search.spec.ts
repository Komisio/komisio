import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('lifecycle search preserves paging and batch scope, and item shortcuts open the exact item', async ({
  page,
}, testInfo) => {
  const email = 'lifecycle-search-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 21; i++)
      await f.item('Search coat ' + String(i).padStart(2, '0'))
    const target = await f.item('Target chair')
    await f.item('Literal% item')
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/lifecycle?stage=markdown_due&page=2')
    const rows = page.locator('.lifecycle-row')
    const search = page.getByLabel(d.lifecycle.search, { exact: true })
    const submit = page.getByRole('button', {
      name: d.items.searchButton,
      exact: true,
    })
    await expect(rows).toHaveCount(3)
    await search.fill('SEARCH coat')
    await submit.click()
    await expect(rows).toHaveCount(20)
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page
      .getByRole('link', { name: d.lifecycle.next, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    expect(new URL(page.url()).searchParams.get('q')).toBe('SEARCH coat')
    expect(new URL(page.url()).searchParams.get('stage')).toBe('markdown_due')
    await expect(page.locator('.lifecycle-row[open]')).toHaveCount(0)
    await search.fill('Target chair')
    await submit.click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toHaveAttribute('open', '')
    await expect(
      page.getByLabel(d.lifecycle.price, { exact: true }),
    ).toBeVisible()
    const batch = page.locator('.lifecycle-automation')
    await batch.locator('summary').click()
    await expect(
      batch.getByRole('button', {
        name: d.lifecycle.applyAllDue.replace('{count}', '23'),
        exact: true,
      }),
    ).toBeVisible()
    await expect(batch).toContainText(d.lifecycle.searchScopeHint)
    await batch.locator('summary').click()
    await page.getByRole('link', { name: d.items.open, exact: false }).click()
    await expect(page).toHaveURL('/intake/items/' + target)
    await page
      .getByRole('link', { name: d.items.manageSalePeriod, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toHaveAttribute('open', '')
    await expect(search).toHaveValue('I-' + target.slice(0, 8).toUpperCase())
    await expect
      .poll(async () => (await rows.boundingBox())?.y ?? 9999)
      .toBeLessThan(200)
    await expect(rows).toContainText('Target chair')
    await page.screenshot({
      path: testInfo.outputPath('lifecycle-search-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('link', { name: d.lifecycle.clearSearch, exact: true })
      .click()
    await expect(rows).toHaveCount(20)
    await expect(search).toHaveValue('')
    await search.fill('%')
    await submit.click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Literal% item')
    await search.fill('Does not exist')
    await submit.click()
    await expect(rows).toHaveCount(0)
    await expect(
      page.getByText(d.lifecycle.noMatches, { exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})
