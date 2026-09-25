import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import all from '../../messages/sv.json' with { type: 'json' }
const d = all.quickIntake

test('quick intake finds sellers beyond the first hundred and keeps stale choices out', async ({
  page,
  request,
}, testInfo) => {
  const email = 'quick-search-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 105; i++)
      await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'AA Search seller ' + String(i).padStart(3, '0'),
        'lookup-' + randomUUID() + '@example.test',
        '0701111111',
      ])
    const target = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'ZZ Target seller',
        'find-later@example.test',
        '0709876543',
      ])
    ).rows[0].id
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/quick')
    const choices = page.locator('.quick-seller .intake-list button')
    const search = page.getByLabel(d.searchSeller, { exact: true })
    await expect(choices).toHaveCount(12)
    await expect(choices.first()).toContainText('AA Search seller 000')
    await page
      .getByRole('button', { name: d.sellerSearchNext, exact: true })
      .click()
    await expect(choices.first()).toContainText('AA Search seller 012')
    await page
      .getByRole('button', { name: d.sellerSearchPrevious, exact: true })
      .click()
    await expect(choices.first()).toContainText('AA Search seller 000')
    await search.fill('0709876543')
    await expect(choices).toHaveCount(1)
    await expect(choices.first()).toContainText('ZZ Target seller')
    await expect(choices.first()).toContainText('find-later@example.test')
    await page.screenshot({
      path: testInfo.outputPath('seller-search-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)

    let releaseSlow!: () => void
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    let slowStarted!: () => void
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve
    })
    await page.route('**/api/sellers/search?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('q') === 'Slow') {
        slowStarted()
        await slow
        await route
          .fulfill({
            json: {
              sellers: [
                { id: target, name: 'Stale wrong choice', contact: null },
              ],
              total: 1,
              offset: 0,
            },
          })
          .catch(() => {})
      } else await route.continue()
    })
    await search.fill('Slow')
    await started
    await expect(choices).toHaveCount(0)
    await search.fill('find-later@example.test')
    await expect(choices).toHaveCount(1)
    await expect(choices.first()).toContainText('ZZ Target seller')
    releaseSlow()
    await choices.first().click()
    await expect(page.locator('.quick-seller-selected')).toContainText(
      'ZZ Target seller',
    )
    await expect(page.getByLabel(d.description, { exact: true })).toBeVisible()
    await expect(
      page.getByText('Stale wrong choice', { exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: d.changeSeller, exact: true })
      .click()
    await expect(choices).toHaveCount(12)
    await page.unroute('**/api/sellers/search?**')
    await page.route(
      '**/api/sellers/search?**',
      (route) =>
        route.fulfill({ status: 500, json: { error: 'SEARCH_FAILED' } }),
      { times: 1 },
    )
    await search.fill('ZZ Target')
    await expect(
      page.getByRole('button', { name: d.sellerSearchRetry, exact: true }),
    ).toBeVisible()
    await expect(choices).toHaveCount(0)
    await page
      .getByRole('button', { name: d.sellerSearchRetry, exact: true })
      .click()
    await expect(choices).toHaveCount(1)
    await search.fill('No such seller')
    await expect(page.getByText(d.noSeller, { exact: true })).toBeVisible()
    await search.fill('')
    await expect(choices).toHaveCount(12)

    const endpoint = '/api/sellers/search?tenant=' + f.tenant
    const result = await page.request.get(endpoint + '&q=0709876543')
    expect(result.status()).toBe(200)
    expect(
      result
        .headers()
        ['cache-control'].split(',')
        .map((value) => value.trim()),
    ).toContain('no-store')
    const body = await result.json()
    expect(body.sellers).toEqual([
      {
        id: target,
        name: 'ZZ Target seller',
        contact: 'find-later@example.test',
      },
    ])
    expect(
      (
        await page.request.get('/api/sellers/search?tenant=' + randomUUID())
      ).status(),
    ).toBe(409)
    expect((await page.request.get(endpoint + '&offset=-1')).status()).toBe(400)
    expect(
      (await page.request.get(endpoint + '&q=' + 'x'.repeat(121))).status(),
    ).toBe(400)
    expect((await request.get(endpoint)).status()).toBe(401)
  } finally {
    await f.close()
  }
})
