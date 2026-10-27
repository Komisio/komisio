import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }

test('concurrent store creation initializes the starter vocabulary once', async ({
  page,
}) => {
  const email = `starter-race-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const { Client } = createRequire(import.meta.url)('pg')
  const clients = [0, 1].map(
    () =>
      new Client({
        connectionString: localTestUrl(
          'TEST_DATABASE_URL',
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        ),
      }),
  )
  try {
    await f.commit()
    const requestId = randomUUID()
    const results = await Promise.all(
      clients.map(async (client) => {
        await client.connect()
        await client.query('begin')
        await client.query('set local role authenticated')
        await client.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: f.actor, role: 'authenticated' }),
        ])
        const result = await client.query('select create_tenant($1,$2,$3) id', [
          'Concurrent starter store',
          `starter-${requestId}`,
          requestId,
        ])
        await client.query('commit')
        return result.rows[0].id
      }),
    )
    expect(results[0]).toBe(results[1])
    const counts = (
      await f.db.query(
        `select
      (select count(*)::int from item_types where tenant_id=$1 and active) types,
      (select count(*)::int from item_type_attributes where tenant_id=$1 and type_slug in ('jacket','trousers')) fields,
      (select count(*)::int from access_events where tenant_id=$1 and action='tenant.created') events`,
        [results[0]],
      )
    ).rows[0]
    expect(counts).toEqual({ types: 2, fields: 14, events: 1 })
  } finally {
    await Promise.all(clients.map((c) => c.end()))
    await f.close()
  }
})

test('a new store starts with translated clothing types and five base attributes', async ({
  page,
}, testInfo) => {
  const email = `starter-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: 'en',
        url: new URL(page.url()).origin,
      },
    ])
    await page.goto('/settings?tab=vocabulary')
    const rows = page.locator('#vocabulary-types tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Jacket')
    await expect(rows.nth(1)).toContainText('Trousers')
    await expect(page.locator('#vocabulary-types')).not.toContainText(
      en.catalogueDeletion.shared,
    )
    await expect(page.locator('#vocabulary-types')).not.toContainText(
      en.vocabularySettings.standard,
    )
    await page
      .getByLabel(en.catalogueEditing.showInactive, { exact: true })
      .check()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toBeVisible()
    for (const field of ['Size', 'Colour', 'Brand', 'Material', 'Condition']) {
      await expect(rows.nth(0)).toContainText(field)
      await expect(rows.nth(1)).toContainText(field)
    }
    await page.screenshot({
      path: testInfo.outputPath('starter-types-en.png'),
      fullPage: true,
    })
    await page
      .getByRole('tab', { name: en.vocabularySettings.attributes, exact: true })
      .click()
    await expect(page.locator('#vocabulary-attributes tbody tr')).toHaveCount(7)
    await expect(page.locator('#vocabulary-attributes')).not.toContainText(
      'Socket',
    )
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page.locator('#quick-item-type').selectOption({ label: 'Jacket' })
    for (const field of ['Size', 'Colour', 'Brand', 'Material', 'Condition'])
      await expect(page.getByLabel(field, { exact: true })).toBeVisible()
    await expect(page.getByLabel('Socket', { exact: true })).toHaveCount(0)
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: 'sv',
        url: new URL(page.url()).origin,
      },
    ])
    await page.goto('/settings?tab=vocabulary')
    await expect(rows.nth(0)).toContainText('Byxor')
    await expect(rows.nth(1)).toContainText('Jacka')
    await expect(rows.nth(0)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('starter-types-sv-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('settings creates an attribute safely and reception renders only the selected profile', async ({
  page,
}, testInfo) => {
  const email = `vocabulary-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const bag = randomUUID()
    await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5)', [
      f.tenant,
      bag,
      f.seller,
      'Synthetic field test',
      f.agreement,
    ])
    await f.commit()
    await page.goto('/settings?tab=vocabulary#vocabulary-attributes')
    const t = d.vocabularySettings
    await page
      .getByRole('button', { name: t.addAttribute, exact: true })
      .click()
    const form = page.getByRole('form', { name: t.addAttribute })
    await form.getByLabel(t.name, { exact: true }).fill('Synthetic width')
    await form.getByLabel(t.kind, { exact: true }).selectOption('number')
    await form.getByLabel(t.unit, { exact: true }).fill('cm')
    const commands: Record<string, unknown>[] = []
    await page.route('**/api/attributes', async (route) => {
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1)
        return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      return route.fulfill({ response })
    })
    await form
      .getByRole('button', { name: t.createAttribute, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(t.uncertain)
    await expect(form.getByLabel(t.name, { exact: true })).toBeDisabled()
    await form
      .getByRole('button', { name: d.quickIntake.typeRetry, exact: true })
      .click()
    await expect(form).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    const slug = 'custom_' + String(commands[0].requestId).replaceAll('-', '')
    expect(
      (
        await f.db.query(
          'select count(*)::int n from attribute_definitions where tenant_id=$1 and slug=$2',
          [f.tenant, slug],
        )
      ).rows[0].n,
    ).toBe(1)
    await expect(
      page.getByRole('row', { name: /Synthetic width/ }),
    ).toContainText('Tal (cm)')
    await page.getByRole('tab', { name: t.types, exact: true }).click()
    await page
      .getByRole('button', { name: d.quickIntake.createType, exact: true })
      .click()
    const editor = page.getByRole('group', { name: d.quickIntake.createType })
    await editor
      .getByLabel(d.quickIntake.typeName, { exact: true })
      .fill('Synthetic bench')
    await expect(
      editor.getByLabel(t.inheritDefaults, { exact: true }),
    ).toBeChecked()
    await editor.getByLabel(t.inheritDefaults, { exact: true }).uncheck()
    await editor.getByLabel('Synthetic width', { exact: true }).check()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await editor
        .getByLabel('Synthetic width', { exact: true })
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(24)
    await page.screenshot({
      path: testInfo.outputPath('type-fields-mobile.png'),
      fullPage: true,
    })
    let warnings = 0
    page.on('dialog', async (dialog) => {
      warnings++
      await dialog.dismiss()
    })
    await page
      .getByRole('link', { name: d.settingsTabs.profile, exact: true })
      .click()
    expect(warnings).toBe(1)
    await expect(
      editor.getByLabel(d.quickIntake.typeName, { exact: true }),
    ).toHaveValue('Synthetic bench')
    await editor
      .getByRole('button', { name: t.createType, exact: true })
      .click()
    await expect(editor).toHaveCount(0)
    await page.goto(`/intake/bags/${bag}/inspect`)
    await expect(
      page.getByRole('button', { name: d.quickIntake.createType, exact: true }),
    ).toHaveCount(0)
    await page
      .locator('#quick-item-type')
      .selectOption({ label: 'Synthetic bench' })
    await page.getByLabel('Synthetic width (cm)', { exact: true }).fill('80')
    await expect(page.getByLabel('Sockel', { exact: true })).toHaveCount(0)
    await page.locator('#quick-item-type').selectOption({ label: 'Jacka' })
    await expect(page.getByLabel('Storlek', { exact: true })).toBeVisible()
    await expect(
      page.getByLabel('Synthetic width (cm)', { exact: true }),
    ).toHaveCount(0)
    await page
      .locator('#quick-item-type')
      .selectOption({ label: 'Synthetic bench' })
    await page.getByLabel('Synthetic width (cm)', { exact: true }).fill('80')
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic wooden bench')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('125')
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(page.locator('.quick-done')).toBeVisible()
    const item = (
      await f.db.query('select id from items where tenant_id=$1', [f.tenant])
    ).rows[0].id
    const attrs = (
      await f.db.query('select komisio_private.item_attributes($1,$2) attrs', [
        f.tenant,
        item,
      ])
    ).rows[0].attrs
    expect(
      attrs.some(
        (a: { slug: string; value: unknown }) =>
          a.slug === slug && String(a.value) === '80',
      ),
    ).toBe(true)
    expect(attrs.some((a: { slug: string }) => a.slug === 'socket')).toBe(false)
    await page.goto('/settings?tab=vocabulary#vocabulary-attributes')
    await page
      .getByLabel(t.searchFields, { exact: true })
      .fill('Synthetic width')
    await expect(page.locator('#vocabulary-attributes tbody tr')).toHaveCount(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('attribute-settings-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('concurrent field creation records one definition and stale-store requests are refused', async ({
  page,
}) => {
  const email = `attribute-race-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const { Client } = createRequire(import.meta.url)('pg')
  const clients = [0, 1].map(
    () =>
      new Client({
        connectionString: localTestUrl(
          'TEST_DATABASE_URL',
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        ),
      }),
  )
  try {
    await f.commit()
    const id = randomUUID()
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
        const r = await c.query(
          'select create_store_attribute($1,$2,$3) slug',
          [
            f.tenant,
            id,
            JSON.stringify({
              dataType: 'text',
              labels: { en: 'Synthetic field' },
            }),
          ],
        )
        await c.query('commit')
        return r.rows[0].slug
      }),
    )
    expect(results[0]).toBe(results[1])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='attribute.defined'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await f.asActor(f.actor, () =>
      f.db.query('select create_tenant($1,$2,$3)', [
        'Synthetic other store',
        `attr-${randomUUID()}`,
        randomUUID(),
      ]),
    )
    const stale = await page.request.post('/api/attributes', {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        tenantId: f.tenant,
        requestId: randomUUID(),
        name: 'Stale field',
        locale: 'en',
        dataType: 'text',
        unit: '',
        choices: [],
      },
    })
    expect(stale.status()).toBe(409)
    expect((await stale.json()).error).toBe('TENANT_CHANGED')
  } finally {
    await Promise.all(clients.map((c) => c.end()))
    await f.close()
  }
})
