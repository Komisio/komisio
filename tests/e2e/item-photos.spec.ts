import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { createRequire } from 'node:module'
const { Client } = createRequire(import.meta.url)('pg')
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('item gallery keeps retries and concurrent defaults safe; compact list previews the selected image', async ({
  page,
}, testInfo) => {
  const email = `item-photos-${randomUUID()}@example.test`
  await register(page, email, `Test!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Photo test jacket')
    await f.commit()
    await page.goto(`/intake/items/${item}`)
    const gallery = page.getByRole('region', {
      name: d.itemPhotos.title,
      exact: true,
    })
    const file = (color: string) =>
      sharp({
        create: { width: 32, height: 48, channels: 3, background: color },
      })
        .png()
        .toBuffer()
    // The server saves successfully, but the first response is lost in transit.
    await page.route('**/api/items/*/photos?*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fetch()
      await route.abort('failed')
    })
    await gallery.getByLabel(d.itemPhotos.add).setInputFiles({
      name: 'synthetic-blue.png',
      mimeType: 'image/png',
      buffer: await file('blue'),
    })
    await expect(gallery.getByRole('alert')).toHaveText(
      d.itemPhotos.unconfirmed,
    )
    await expect(gallery.getByLabel(d.itemPhotos.add)).toBeDisabled()
    await page.unroute('**/api/items/*/photos?*')
    await gallery
      .getByRole('button', { name: d.itemPhotos.retry, exact: true })
      .click()
    await expect(gallery.locator('figure')).toHaveCount(1)
    await expect(gallery.getByLabel(d.itemPhotos.add)).toBeEnabled()
    await gallery.getByLabel(d.itemPhotos.add).setInputFiles({
      name: 'synthetic-red.png',
      mimeType: 'image/png',
      buffer: await file('red'),
    })
    await expect(gallery.locator('figure')).toHaveCount(2)
    await gallery
      .getByRole('button', { name: d.itemPhotos.setDefault, exact: true })
      .click()
    await expect(gallery.locator('figure').nth(1)).toHaveAttribute(
      'data-default',
      'true',
    )
    const snapshot = async () =>
      f.asActor(
        f.actor,
        async () =>
          (
            await f.db.query('select item_photo_state($1,$2) as states', [
              f.tenant,
              [item],
            ])
          ).rows[0].states[0],
      )
    const state = await snapshot()
    expect(state.revision).toBe(3)
    expect(state.photos).toHaveLength(2)
    await page.goto('/intake/lifecycle')
    const row = page.locator(`#lifecycle-${item}`)
    const summary = row.locator('summary').first()
    await expect(summary).toBeVisible()
    expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(48)
    const icon = row.getByRole('button', {
      name: d.itemPhotos.preview.replace('{count}', '2'),
    })
    await icon.hover()
    const preview = page.getByRole('tooltip')
    await expect(preview.locator('img')).toHaveAttribute(
      'src',
      new RegExp(state.defaultPhotoId),
    )
    await expect
      .poll(() =>
        preview
          .locator('img')
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)
    await page.screenshot({
      path: testInfo.outputPath('lifecycle-photo-desktop.png'),
      fullPage: true,
    })
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    await icon.focus()
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    await page.setViewportSize({ width: 375, height: 812 })
    await icon.click()
    await expect(preview).toBeVisible()
    await expect(row).not.toHaveAttribute('open', '')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const box = (await preview.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    await page.screenshot({
      path: testInfo.outputPath('lifecycle-photo-mobile.png'),
      fullPage: true,
    })
    // Two database sessions race the same observed revision: exactly one may win.
    const clients = [
      new Client({
        connectionString:
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      }),
      new Client({
        connectionString:
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      }),
    ]
    try {
      for (const c of clients) {
        await c.connect()
        await c.query('set role authenticated')
        await c.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({ sub: f.actor, role: 'authenticated' }),
        ])
      }
      const results = await Promise.all(
        clients.map((c, i) =>
          c
            .query("select change_item_photo($1,$2,$3,3,'default',$4)", [
              f.tenant,
              randomUUID(),
              item,
              state.photos[i].id,
            ])
            .then(
              () => 'saved',
              (e: Error) => e.message,
            ),
        ),
      )
      expect(results.filter((r) => r === 'saved')).toHaveLength(1)
      expect(results.filter((r) => r === 'ITEM_PHOTOS_CHANGED')).toHaveLength(1)
    } finally {
      await Promise.all(clients.map((c) => c.end()))
    }
    await page.goto(`/intake/items/${item}`)
    await gallery
      .locator('figure[data-default="true"]')
      .getByRole('button', { name: d.itemPhotos.remove, exact: true })
      .click()
    await expect(gallery.locator('figure')).toHaveCount(1)
    await expect(gallery.locator('figure')).toHaveAttribute(
      'data-default',
      'true',
    )
    expect((await snapshot()).revision).toBe(5)
    expect(
      (
        await f.db.query(
          'select count(*)::int as n from item_photo_revisions where item_id=$1',
          [item],
        )
      ).rows[0].n,
    ).toBe(5)
    const src = await gallery.locator('img').getAttribute('src')
    const crossStore = src!.replace(f.tenant, randomUUID())
    expect((await page.request.get(crossStore)).status()).toBe(409)
  } finally {
    await f.close()
  }
})
