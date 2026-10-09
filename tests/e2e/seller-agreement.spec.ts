import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'

test('seller accepts the displayed agreement with safe retries and sees new versions', async ({
  page,
}) => {
  const email = `agreement-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  const owner = randomUUID(),
    version = randomUUID()
  try {
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `${owner}@example.test`],
    )
    await db.query('set role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ])
    const tenant = (
      await db.query('select create_tenant($1,$2,$3) id', [
        'Agreement TEST',
        `agreement-${owner}`,
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
    await db.query(
      "select publish_seller_agreement($1,$2,null,'TEST seller agreement','Fictional terms for browser testing only.','en',false)",
      [tenant, version],
    )
    await page.goto(`/seller?seller=${seller}`)
    await page.getByRole('link', { name: 'Läs och acceptera avtalet' }).click()
    await expect(
      page.getByRole('heading', { name: 'TEST seller agreement' }),
    ).toBeVisible()
    await expect(
      page.getByText('Fictional terms for browser testing only.'),
    ).toHaveAttribute('lang', 'en-GB')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await page.route(
      '**/api/seller/agreement',
      async (route) => {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.abort('failed')
      },
      { times: 1 },
    )
    await page.getByRole('button', { name: 'Jag accepterar avtalet' }).click()
    await expect(page.locator('article').getByRole('alert')).toContainText(
      'Försök igen',
    )
    await page.getByRole('button', { name: 'Jag accepterar avtalet' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Avtalet är accepterat',
    )
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Jag accepterar avtalet' }),
    ).toHaveCount(0)
    expect(
      (
        await db.query(
          'select count(*)::int n from seller_agreement_evidence where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.screenshot({
      path: test.info().outputPath('seller-agreement-accepted-mobile.png'),
      fullPage: true,
    })
    const v2 = randomUUID(),
      v3 = randomUUID()
    await db.query(
      "select publish_seller_agreement($1,$2,$3,'Updated TEST agreement','New fictional terms','en',false)",
      [tenant, v2, version],
    )
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Jag accepterar avtalet' }),
    ).toBeVisible()
    await db.query(
      "select publish_seller_agreement($1,$2,$3,'Latest TEST agreement','Latest fictional terms','en',false)",
      [tenant, v3, v2],
    )
    await page.getByRole('button', { name: 'Jag accepterar avtalet' }).click()
    await expect(page.locator('article').getByRole('alert')).toContainText(
      'Avtalet har ändrats',
    )
    await page
      .getByRole('button', { name: 'Ladda om sidan', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Latest TEST agreement' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Jag accepterar avtalet' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Avtalet är accepterat',
    )
  } finally {
    await db.end()
  }
})
