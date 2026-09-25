import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('bag reception saves one item at a time with optional photo and inherited seller', async ({
  page,
}) => {
  const email = `bag-quick-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic bag',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(`/intake/bags/${bag}/inspect`)
    await expect(page.locator('.quick-item h2')).not.toBeFocused()
    await expect(
      page.getByText('Synthetic P2 seller', { exact: false }).first(),
    ).toBeVisible()
    await expect(
      page.getByLabel(d.quickIntake.searchSeller, { exact: true }),
    ).toHaveCount(0)
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic lamp')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('150')
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(page.locator('.bag-received-items li')).toHaveCount(1)
    await page
      .getByRole('button', { name: d.bagIntake.next, exact: true })
      .click()
    await expect(
      page.getByLabel(d.quickIntake.description, { exact: true }),
    ).toHaveValue('')
    await expect(page.locator('.quick-item h2')).toBeFocused()
    await expect(page.locator('.quick-item h2')).toBeInViewport()
    await page.screenshot({
      path: test.info().outputPath('next-item-mobile.png'),
      caret: 'initial',
    })
    const photo = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#346789' },
    })
      .png()
      .toBuffer()
    await page.locator('input[type=file]').setInputFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: photo,
    })
    await expect(
      page.getByRole('button', { name: d.bagIntake.save, exact: true }),
    ).toBeEnabled()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic vase')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('75')
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(page.locator('.bag-received-items li')).toHaveCount(2)
    await page.reload()
    await expect(page.locator('.bag-received-items li')).toHaveCount(2)
    const rows = (
      await f.db.query(
        'select s.seller_id,s.bag_id from items i join reception_sessions s on s.id=i.origin_id where i.tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(
      rows.every(
        (r: { seller_id: string; bag_id: string }) =>
          r.seller_id === f.seller && r.bag_id === bag,
      ),
    ).toBe(true)
    await expect(page.locator('.bag-received-items img')).toHaveCount(1)
    await page.screenshot({
      path: 'private/bag-reception-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: 'private/bag-reception-mobile.png',
      fullPage: true,
    })
    await page.getByRole('link', { name: d.bagIntake.drafts }).click()
    await expect(page.getByLabel('Beskrivning av varan')).toBeVisible()
  } finally {
    await f.close()
  }
})

test('concurrent retries create one bag session and one item', async ({
  page,
}) => {
  const email = `bag-race-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const { Client } = createRequire(import.meta.url)('pg')
  const clients = [0, 1].map(
    () =>
      new Client({
        connectionString:
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      }),
  )
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Concurrent synthetic bag',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    const session = randomUUID(),
      request = randomUUID()
    await Promise.all(
      clients.map(async (db) => {
        await db.connect()
        await db.query('begin')
        await db.query('set local role authenticated')
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: f.actor, role: 'authenticated' }),
        ])
        await db.query('select create_bag_reception($1,$2,$3,$4)', [
          f.tenant,
          session,
          f.seller,
          bag,
        ])
        await db.query(
          'select quick_receive_from_bag($1,$2,$3,$4,0,$5,10000,$6)',
          [
            f.tenant,
            request,
            session,
            f.seller,
            JSON.stringify({ description: 'Concurrent synthetic item' }),
            bag,
          ],
        )
        await db.query('commit')
      }),
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_sessions where id=$1',
          [session],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where origin_id=$1',
          [session],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await Promise.all(clients.map((db) => db.end()))
    await f.close()
  }
})
