import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('create a type in bag reception, replay a lost reply and retain the item', async ({
  page,
}) => {
  const email = `create-type-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const bag = randomUUID()
    await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5)', [
      f.tenant,
      bag,
      f.seller,
      'Synthetic type test',
      f.agreement,
    ])
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/intake/bags/${bag}/inspect`)
    const photo = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#cc3333' },
    })
      .png()
      .toBuffer()
    const photoInput = page.locator('#quick-photo')
    // File selection does not wait for the input's hydration readiness.
    await expect(photoInput).toBeEnabled()
    await photoInput.setInputFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: photo,
    })
    await expect(
      page.getByRole('img', { name: d.quickIntake.photo, exact: true }),
    ).toBeVisible()
    const create = page.getByRole('button', {
      name: d.quickIntake.createType,
      exact: true,
    })
    await expect(create).toBeEnabled()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic red shirt')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('125')
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/item-types', async (route) => {
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1)
        return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      return route.fulfill({ response })
    })
    await create.click()
    const editor = page.getByRole('group', { name: d.quickIntake.createType })
    await expect(page.getByLabel(d.quickIntake.typeName)).toBeFocused()
    await page.getByLabel(d.quickIntake.typeName).fill('Skjorta')
    await page.getByLabel(d.quickIntake.typeFields).selectOption('sweater')
    await page.screenshot({
      path: 'private/create-item-type-mobile.png',
      fullPage: true,
    })
    await page.getByLabel(d.quickIntake.typeName).press('Enter')
    await expect(editor.getByRole('alert')).toHaveText(
      d.quickIntake.typeUncertain,
    )
    await expect(page.getByLabel(d.quickIntake.typeName)).toBeDisabled()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await editor.getByRole('button', { name: d.quickIntake.typeRetry }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('#quick-item-type')).toHaveValue('Skjorta')
    await expect(page.locator('#quick-item-type')).toBeFocused()
    await expect(description).toHaveValue('Synthetic red shirt')
    await expect(
      page.getByLabel(d.quickIntake.price, { exact: true }),
    ).toHaveValue('125')
    await expect(
      page.getByRole('img', { name: d.quickIntake.photo, exact: true }),
    ).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='item_type.set'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(page.locator('.quick-done')).toBeVisible()
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.goto('/intake/quick')
    await page
      .getByLabel(d.quickIntake.searchSeller, { exact: true })
      .fill('Synthetic')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(
      page.locator('#quick-item-types option[value="Skjorta"]'),
    ).toHaveCount(1)
  } finally {
    await f.close()
  }
})

test('type creation serializes concurrent replays and refuses stale-store and staff requests', async ({
  page,
  browser,
}) => {
  const email = `type-boundaries-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  const { Client } = createRequire(import.meta.url)('pg')
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
    await f.commit()
    const id = randomUUID()
    const attributes = [{ slug: 'description', expected: true, sort: 0 }]
    await Promise.all(
      clients.map(async (c) => {
        await c.connect()
        await c.query('begin')
        await c.query('set local role authenticated')
        await c.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: f.actor, role: 'authenticated' }),
        ])
      }),
    )
    const results = await Promise.all(
      clients.map(async (c) => {
        const result = await c.query(
          'select create_item_type($1,$2,$3,$4,$5) slug',
          [f.tenant, id, 'Concurrent shirt', 'en', JSON.stringify(attributes)],
        )
        await c.query('commit')
        return result.rows[0].slug
      }),
    )
    expect(results[0]).toBe(results[1])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='item_type.set'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select create_tenant($1,$2,$3) id', [
            'Other type store',
            `type-${randomUUID()}`,
            randomUUID(),
          ])
        ).rows[0].id,
    )
    const stale = await page.request.post('/api/item-types', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: {
        tenantId: f.tenant,
        requestId: randomUUID(),
        name: 'Stale',
        locale: 'en',
        attributes,
      },
    })
    expect(stale.status()).toBe(409)
    expect((await stale.json()).error).toBe('TENANT_CHANGED')
    const context = await browser.newContext()
    try {
      const staffPage = await context.newPage()
      const staffEmail = `type-staff-${randomUUID()}@example.test`
      await register(
        staffPage,
        staffEmail,
        `K!${randomBytes(16).toString('hex')}`,
      )
      const invitation = randomBytes(32).toString('hex')
      await f.asActor(f.actor, async () => {
        await f.db.query('select create_invitation($1,$2,$3,$4)', [
          f.tenant,
          staffEmail,
          'staff',
          invitation,
        ])
      })
      const staff = (
        await f.db.query('select id from auth.users where email=$1', [
          staffEmail,
        ])
      ).rows[0].id
      await f.asActor(staff, async () => {
        await f.db.query('select accept_invitation($1)', [invitation])
      })
      const forbidden = await staffPage.request.post('/api/item-types', {
        headers: { Origin: 'http://127.0.0.1:3000' },
        data: {
          tenantId: f.tenant,
          requestId: randomUUID(),
          name: 'Denied',
          locale: 'en',
          attributes,
        },
      })
      expect(forbidden.status()).toBe(403)
      await staffPage.goto('/intake/quick')
      await staffPage
        .getByLabel(d.quickIntake.searchSeller, { exact: true })
        .fill('Synthetic')
      await staffPage
        .getByRole('button', { name: /Synthetic P2 seller/ })
        .click()
      await expect(
        staffPage.getByRole('button', {
          name: d.quickIntake.createType,
          exact: true,
        }),
      ).toHaveCount(0)
    } finally {
      await context.close()
    }
  } finally {
    await Promise.all(clients.map((c) => c.end()))
    await f.close()
  }
})
