import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
test('seller reads own economy, requests payout and opts out without becoming staff', async ({
  page,
}) => {
  const email = `seller-portal-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  await expect(page).toHaveURL(/\/seller$/)
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  let sellerId = ''
  try {
    const owner = randomUUID()
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `portal-staff-${owner}@example.test`],
    )
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ])
    const tenant = (
      await db.query('select create_tenant($1,$2,$3) id', [
        'Portal journey',
        `portal-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id
    sellerId = (
      await db.query('select register_seller($1,$2,$3,$4,$5) id', [
        tenant,
        randomUUID(),
        'Synthetic seller',
        email,
        '',
      ])
    ).rows[0].id
    await db.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
      tenant,
      randomUUID(),
      sellerId,
      20000,
      'PRIVATE staff reason',
    ])
    await db.query(
      "select issue_statement($1,$2,$3,'2000-01-01',clock_timestamp())",
      [tenant, randomUUID(), sellerId],
    )
    await db.query('commit')
    await page.goto(`/seller?seller=${sellerId}`)
    await expect(
      page.getByRole('heading', { name: /Tillg.*200/ }),
    ).toBeVisible()
    await expect(page.getByText('PRIVATE staff reason')).toHaveCount(0)
    await expect(
      page
        .getByRole('region', { name: 'Mina varor', exact: true })
        .getByText('Inga varor ännu.', { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('seller-portal.png'),
      fullPage: true,
    })
    await page.getByLabel('Belopp i SEK').fill('100,00')
    await page
      .getByRole('button', { name: 'Begär utbetalning', exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText('Sparat.')
    await expect(page.getByText(/Begärd av:/)).toBeVisible()
    const row = (
      await db.query(
        'select request_source,status,requested_by from payouts where tenant_id=$1 and seller_id=$2',
        [tenant, sellerId],
      )
    ).rows[0]
    expect(row.request_source).toBe('seller')
    expect(row.status).toBe('requested')
    expect(row.requested_by).not.toBe(owner)
    await page.getByRole('checkbox').uncheck()
    // Wait for persistence before reloading; the checkbox changes immediately.
    const savedPreference = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/seller/economy') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.action === 'notifications',
    )
    await page.getByRole('button', { name: 'Spara mejlval' }).click()
    expect((await savedPreference).ok()).toBe(true)
    await expect(page.getByRole('status')).toHaveText('Sparat.')
    await expect(page.getByRole('checkbox')).not.toBeChecked()
    await page.reload()
    await expect(page.getByRole('checkbox')).not.toBeChecked()
    await page.getByRole('link', { name: 'Visa avräkning #1' }).click()
    await expect(
      page.getByRole('heading', { name: 'Avräkningar #1' }),
    ).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Belopp i SEK', exact: true }),
    ).toHaveCount(1)
    await page.setViewportSize({ width: 320, height: 800 })
    const statementCells = page.locator('.seller-statement-lines td')
    await expect(statementCells).toHaveCount(5)
    for (const cell of await statementCells.all())
      expect((await cell.boundingBox())!.width).toBeGreaterThan(200)
    expect(
      await statementCells.evaluateAll((cells) =>
        cells.map((cell) =>
          getComputedStyle(cell, '::before').content.replaceAll('"', ''),
        ),
      ),
    ).toEqual([
      'Datum',
      'Händelse',
      'Belopp i SEK',
      'Försäljningspris',
      'Provision',
    ])
    await page.screenshot({
      path: test.info().outputPath('seller-statement-mobile.png'),
      caret: 'initial',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('link', { name: 'Portal journey', exact: true })
      .click()
    await expect(page).toHaveURL(/#portal-statements$/)
    await expect(page.locator('#portal-statements h2')).toBeInViewport()
    expect(
      (
        await db.query(
          'select count(*)::int n from tenant_members where user_id=$1',
          [row.requested_by],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await db.query('rollback')
    await db.end()
  }
})
