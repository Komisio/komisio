import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }

test('categories and groups are registered in settings and selected on items', async ({
  page,
}, testInfo) => {
  const email = `catalog-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic catalogue item')
    await f.commit()
    await page.goto('/settings?tab=vocabulary#vocabulary-categories')
    for (const name of [
      d.vocabularySettings.categories,
      d.vocabularySettings.types,
      d.vocabularySettings.attributes,
      d.vocabularySettings.groups,
    ])
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    const form = page.getByRole('form', {
      name: d.vocabularySettings.addCategory,
      exact: true,
    })
    await form
      .getByLabel(d.vocabularySettings.addCategory, { exact: true })
      .fill('Böcker')
    await form.locator('summary').click()
    await form.getByLabel('English', { exact: true }).fill('Books')
    const commands: unknown[] = []
    await page.route('**/api/categories', async (route) => {
      commands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (commands.length === 1)
        return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      return route.fulfill({ response })
    })
    await form
      .getByRole('button', {
        name: d.vocabularySettings.createCategory,
        exact: true,
      })
      .click()
    await expect(
      page.locator('#vocabulary-categories [role="alert"]'),
    ).toHaveText(d.vocabularySettings.uncertain)
    await expect(
      form.getByLabel(d.vocabularySettings.addCategory, { exact: true }),
    ).toBeDisabled()
    await form
      .getByRole('button', { name: d.quickIntake.typeRetry, exact: true })
      .click()
    await expect(
      page.locator('#vocabulary-categories [role="status"]'),
    ).toContainText('Böcker')
    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual(commands[1])
    await page.unroute('**/api/categories')
    await form
      .getByLabel(d.vocabularySettings.addCategory, { exact: true })
      .fill('Böcker')
    await form
      .getByRole('button', {
        name: d.vocabularySettings.createCategory,
        exact: true,
      })
      .click()
    await expect(
      page.locator('#vocabulary-categories [role="alert"]'),
    ).toHaveText(d.vocabularySettings.categoryExists)
    await form
      .getByRole('button', { name: d.quickIntake.typeCancel, exact: true })
      .click()
    await form
      .getByLabel(d.vocabularySettings.addCategory, { exact: true })
      .fill('')
    await page
      .getByRole('tab', { name: d.vocabularySettings.groups, exact: true })
      .click()
    const groups = page.getByRole('form', {
      name: d.itemWorkflow.newGroup,
      exact: true,
    })
    await groups
      .getByLabel(d.itemWorkflow.newGroup, { exact: true })
      .fill('Vintage')
    const groupCommands: unknown[] = []
    await page.route('**/api/items/classification', async (route) => {
      groupCommands.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (groupCommands.length === 1)
        return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
      return route.fulfill({ response })
    })
    await groups
      .getByRole('button', { name: d.itemWorkflow.createGroup, exact: true })
      .click()
    await expect(page.locator('#vocabulary-groups [role="alert"]')).toHaveText(
      d.vocabularySettings.uncertain,
    )
    await groups
      .getByRole('button', { name: d.quickIntake.typeRetry, exact: true })
      .click()
    await expect(
      page.locator('#vocabulary-groups [role="status"]'),
    ).toContainText('Vintage')
    expect(groupCommands[0]).toEqual(groupCommands[1])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: testInfo.outputPath('catalog-groups-mobile.png'),
      fullPage: true,
    })
    await page.goto(`/intake/items/${item}`)
    const editCategory = page.getByRole('button', {
      name: new RegExp(
        '^' + d.itemWorkflow.editRow + ' ' + d.quickIntake.category + ':',
      ),
    })
    await expect(editCategory).toContainText('Jackets')
    await editCategory.click()
    const select = page.getByRole('combobox', {
      name: d.quickIntake.category,
      exact: true,
    })
    await expect(select.locator('option[value="Jackets"]')).toHaveText(
      'Jackets',
    )
    await select.selectOption('Böcker')
    await select.press('Enter')
    await expect(editCategory).toContainText('Böcker')
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: 'en',
        url: new URL(page.url()).origin,
      },
    ])
    await page.reload()
    await expect(
      page.getByRole('button', {
        name: new RegExp(
          '^' + en.itemWorkflow.editRow + ' ' + en.quickIntake.category + ':',
        ),
      }),
    ).toContainText('Books')
    await page.goto('/settings?tab=vocabulary#vocabulary-categories')
    const row = page.getByRole('row', { name: /Books/ })
    await expect(row).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({
      path: testInfo.outputPath('catalog-categories-en.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('category writes serialize and enforce owner and active-store boundaries', async ({
  page,
  browser,
}) => {
  const email = `catalog-owner-${randomUUID()}@example.test`
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
    const results = await Promise.all(
      clients.map(async (c) => {
        await c.connect()
        await c.query('begin')
        await c.query('set local role authenticated')
        await c.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: f.actor, role: 'authenticated' }),
        ])
        const result = await c.query(
          'select create_item_category($1,$2,$3,$4) id',
          [f.tenant, id, 'Concurrent books', { en: 'Books' }],
        )
        await c.query('commit')
        return result.rows[0].id
      }),
    )
    expect(results).toEqual([id, id])
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='category.created'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    const staffContext = await browser.newContext()
    try {
      const staffPage = await staffContext.newPage(),
        staffEmail = `catalog-staff-${randomUUID()}@example.test`
      await register(staffPage, staffEmail, `K!${randomUUID()}`)
      const uid = (
        await f.db.query('select id from auth.users where email=$1', [
          staffEmail,
        ])
      ).rows[0].id
      await f.db.query('begin')
      await f.db.query('set local role authenticated')
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: f.actor, role: 'authenticated' }),
      ])
      const token = randomUUID().replaceAll('-', '').repeat(2)
      await f.db.query('select create_invitation($1,$2,$3,$4)', [
        f.tenant,
        staffEmail,
        'staff',
        token,
      ])
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ])
      await f.db.query('select accept_invitation($1)', [token])
      await f.db.query('commit')
      await staffPage.goto('/settings?tab=vocabulary#vocabulary-categories')
      await expect(
        staffPage.getByRole('form', {
          name: d.vocabularySettings.addCategory,
          exact: true,
        }),
      ).toHaveCount(0)
      const response = await staffPage.request.post('/api/categories', {
        headers: { origin: new URL(staffPage.url()).origin },
        data: {
          tenantId: f.tenant,
          requestId: randomUUID(),
          name: 'Denied',
          labels: { en: 'Denied' },
        },
      })
      expect(response.status()).toBe(403)
    } finally {
      await staffContext.close()
    }
    await f.db.query('begin')
    await f.db.query('set local role authenticated')
    await f.db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: f.actor, role: 'authenticated' }),
    ])
    await f.db.query('select create_tenant($1,$2,$3)', [
      'Other catalogue store',
      `cat-${randomUUID()}`,
      randomUUID(),
    ])
    await f.db.query('commit')
    const response = await page.request.post('/api/categories', {
      headers: { origin: new URL(page.url()).origin },
      data: {
        tenantId: f.tenant,
        requestId: randomUUID(),
        name: 'Stale',
        labels: { en: 'Stale' },
      },
    })
    expect(response.status()).toBe(409)
  } finally {
    await Promise.all(clients.map((c) => c.end()))
    await f.close()
  }
})
