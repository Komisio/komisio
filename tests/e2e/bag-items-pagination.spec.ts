import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('every item in a large bag remains reachable on mobile', async ({
  page,
}) => {
  const email = `bag-pages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic large consignment',
        f.agreement,
      ])
    ).rows[0].id
    for (let n = 0; n < 53; n++) {
      const session = randomUUID()
      await f.db.query('select create_bag_reception($1,$2,$3,$4)', [
        f.tenant,
        session,
        f.seller,
        bag,
      ])
      await f.db.query(
        'select quick_receive_from_bag($1,$2,$3,$4,0,$5,$6,$7)',
        [
          f.tenant,
          randomUUID(),
          session,
          f.seller,
          JSON.stringify({ description: `Synthetic bag item ${n}` }),
          10000 + n,
          bag,
        ],
      )
    }
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(`/intake/bags/${bag}/inspect`)
    await page
      .getByRole('link', {
        name: `${d.bagIntake.registered} (53)`,
        exact: true,
      })
      .click()
    await expect(page.locator('#bag-registered h2')).toBeInViewport()
    const rows = page.locator('.bag-received-items li')
    const links = page.locator('.bag-received-items li a')
    const seen = new Set<string>()
    for (let n = 1; n <= 3; n++) {
      await expect(page.locator('#bag-registered')).toContainText(
        d.items.pageOf.replace('{page}', String(n)).replace('{pages}', '3'),
      )
      await expect(rows).toHaveCount(n === 3 ? 3 : 25)
      for (const href of await links.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('href')!),
      )) {
        expect(seen.has(href)).toBe(false)
        seen.add(href)
      }
      await expect(page.locator('#bag-registered')).toContainText(
        d.items.pageOf.replace('{page}', String(n)).replace('{pages}', '3'),
      )
      if (n < 3)
        await page
          .locator('#bag-registered')
          .getByRole('link', { name: d.items.nextPage, exact: true })
          .click()
    }
    expect(seen.size).toBe(53)
    await expect(page.locator('#bag-registered h2')).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('bag-last-page-mobile.png'),
      caret: 'initial',
    })
    await page
      .locator('#bag-registered')
      .getByRole('link', { name: d.items.previousPage, exact: true })
      .click()
    await expect(rows).toHaveCount(25)
    await page.goto(`/intake/bags/${bag}/inspect?itemPage=999`)
    await expect(page).toHaveURL(new RegExp(`itemPage=3#bag-registered$`))
    await expect(rows).toHaveCount(3)
    await links.first().click()
    await expect(page).toHaveURL(/\/intake\/items\//)
  } finally {
    await f.close()
  }
})
