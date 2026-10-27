import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller chooses between stores without seeing approved application queues', async ({
  page,
}, testInfo) => {
  const email = `store-cards-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`, '/seller')
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await db.connect()
  try {
    const owner = randomUUID()
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `cards-owner-${owner}@example.test`],
    )
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ])
    const sellers: string[] = []
    for (const name of ['First store', 'Second store']) {
      const tenant = (
        await db.query('select create_tenant($1,$2,$3) id', [
          name,
          `cards-${randomUUID()}`,
          randomUUID(),
        ])
      ).rows[0].id
      const seller = (
        await db.query('select register_seller($1,$2,$3,$4,$5) id', [
          tenant,
          randomUUID(),
          'Synthetic seller',
          email,
          '',
        ])
      ).rows[0].id
      sellers.push(seller)
      await db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
        tenant,
        randomUUID(),
        seller,
        8000,
        'Synthetic store-card balance',
      ])
    }
    await db.query('commit')
    await page.goto('/seller?stores=1')
    await expect(page.locator('a.seller-store-card')).toHaveCount(2)
    await expect(
      page.getByRole('heading', {
        name: d.selfRegistration.queue,
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(page.locator('a.seller-store-card').first()).toContainText(
      '80,00 kr',
    )
    await expect(page.locator('.seller-header')).toBeVisible()
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`stores-multiple-${width}.png`),
        fullPage: true,
      })
    }
    await page.getByRole('link', { name: /Second store/ }).click()
    await expect(page).toHaveURL(new RegExp('seller=' + sellers[1]))
    await expect(
      page.getByRole('heading', { name: 'Second store', exact: true }),
    ).toBeVisible()
  } finally {
    await db.query('rollback')
    await db.end()
  }
})
