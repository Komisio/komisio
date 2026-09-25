import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { register } from '../helpers/account'
test('seller sees the next price step, days left and what happens at period end', async ({
  page,
}) => {
  const email = `seller-next-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`, '/seller')
  await expect(page).toHaveURL(/\/seller$/)
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  try {
    const owner = randomUUID()
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `next-staff-${owner}@example.test`],
    )
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ])
    const tenant = (
      await db.query('select create_tenant($1,$2,$3) id', [
        'Next step journey',
        `next-${owner}`,
        randomUUID(),
      ])
    ).rows[0].id
    const sellerId = (
      await db.query('select register_seller($1,$2,$3,$4,$5) id', [
        tenant,
        randomUUID(),
        'Synthetic seller',
        email,
        '',
      ])
    ).rows[0].id
    const agreement = (
      await db.query(
        "select publish_seller_agreement($1,$2,null,'Synthetic terms','Only a test','sv',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    await db.query(
      "select record_agreement_evidence($1,$2,$3,$4,'Signed paper')",
      [tenant, randomUUID(), sellerId, agreement],
    )
    // A first step due at once, so the next price is visible on the same day.
    await db.query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy')
        || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","salePeriodDays":42,"endOfPeriodAction":"charity","markdownSteps":[{"afterDays":0,"percent":10},{"afterDays":28,"percent":25}]}'::jsonb)`,
      [tenant, randomUUID()],
    )
    const bag = (
      await db.query("select receive_bag_with_agreement($1,$2,$3,'',$4) id", [
        tenant,
        randomUUID(),
        sellerId,
        agreement,
      ])
    ).rows[0].id
    const draft = randomUUID()
    await db.query(
      "select save_inspection_draft($1,$2,$3,$4,0,'Blå ullkappa','Kappor','Bra')",
      [tenant, randomUUID(), bag, draft],
    )
    await db.query("select accept_item($1,$2,'inspection_draft',$3,1,30000)", [
      tenant,
      randomUUID(),
      draft,
    ])
    await db.query('commit')
    await page.goto(`/seller?seller=${sellerId}`)
    const items = page.getByRole('region', { name: 'Mina varor', exact: true })
    await expect(items.getByText('Blå ullkappa · Kappor')).toBeVisible()
    await expect(
      items.getByText(/Butiken kan sänka priset till 270\.00 SEK från/),
    ).toBeVisible()
    await expect(items.getByText(/42 dagar kvar/)).toBeVisible()
    await expect(items.getByText(/sedan skänks till välgörenhet/)).toBeVisible()
    await expect(items.getByText('Bra')).toHaveCount(0)
    await page.setViewportSize({ width: 320, height: 800 })
    await expect(
      items.getByText(/Butiken kan sänka priset till 270\.00 SEK från/),
    ).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('seller-next-step-mobile.png'),
      fullPage: true,
    })
  } finally {
    await db.query('rollback').catch(() => undefined)
    await db.end()
  }
})
