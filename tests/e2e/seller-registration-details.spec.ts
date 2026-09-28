import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('optional seller details survive a lost reply and concurrent registration replays', async ({
  page,
}) => {
  const email = `seller-details-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake#new-seller')
    await page
      .getByLabel(d.intake.name, { exact: true })
      .fill('Synthetic extra fields')
    await page
      .getByLabel(d.intake.email, { exact: true })
      .fill('extra@example.test')
    const more = page
      .locator('summary')
      .filter({ hasText: d.sellerDetails.moreFields })
    await expect(page.locator('#new-seller-nationalId')).not.toBeVisible()
    await more.focus()
    await page.keyboard.press('Enter')
    await page.locator('#new-seller-nationalId').fill('SYNTHETIC-ID')
    await page.locator('#new-seller-addressLine1').fill('Synthetic Street 2')
    await page.locator('#new-seller-postalCode').fill('12345')
    await page.locator('#new-seller-city').fill('Test City')
    await page.locator('#new-seller-country').fill('Sweden')
    await page.screenshot({
      path: 'private/new-seller-details-mobile.png',
      fullPage: true,
    })
    await more.click()
    let body: Record<string, unknown> | undefined
    await page.route('**/api/intake', async (route) => {
      if (route.request().postDataJSON().action !== 'registerSeller')
        return route.continue()
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      body = route.request().postDataJSON()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"REQUEST_FAILED"}',
      })
      await page.unroute('**/api/intake')
    })
    await page
      .getByRole('button', { name: d.intake.saveSeller, exact: true })
      .click()
    await expect(
      page.getByRole('alert').filter({ hasText: d.intake.failed }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`seller=${body!.requestId}`))
    const saved = (
      await f.db.query('select profile from sellers where id=$1', [
        body!.requestId,
      ])
    ).rows[0].profile
    expect(saved.nationalId).toBe('SYNTHETIC-ID')
    expect(saved.addressLine1).toBe('Synthetic Street 2')
    await page.goto(`/intake/sellers/${body!.requestId}#seller-details`)
    await page.getByText(d.sellerDetails.edit, { exact: true }).click()
    await page.getByText(d.sellerDetails.moreFields, { exact: true }).click()
    await expect(page.locator('#seller-profile-nationalId')).toHaveValue(
      'SYNTHETIC-ID',
    )
    await expect(page.locator('#seller-profile-city')).toHaveValue('Test City')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)

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
    const id = randomUUID()
    const profile = {
      ...{
        name: 'Concurrent seller',
        email: 'concurrent@example.test',
        phone: '',
        addressLine1: '',
        addressLine2: '',
        postalCode: '',
        city: '',
        country: '',
        language: '',
        notes: '',
      },
      nationalId: 'SYNTHETIC-CONCURRENT',
    }
    try {
      const results = await Promise.all(
        clients.map(async (client) => {
          await client.connect()
          await client.query('begin')
          await client.query('set local role authenticated')
          await client.query(
            "select set_config('request.jwt.claims',$1,true)",
            [JSON.stringify({ sub: f.actor, role: 'authenticated' })],
          )
          const result = await client.query(
            'select register_seller_with_profile($1,$2,$3) id',
            [f.tenant, id, JSON.stringify(profile)],
          )
          await client.query('commit')
          return result.rows[0].id
        }),
      )
      expect(results).toEqual([id, id])
      expect(
        (
          await f.db.query(
            'select count(*)::int n from seller_profile_versions where seller_id=$1',
            [id],
          )
        ).rows[0].n,
      ).toBe(2)
    } finally {
      await Promise.all(clients.map((client) => client.end()))
    }
  } finally {
    await f.close()
  }
})
