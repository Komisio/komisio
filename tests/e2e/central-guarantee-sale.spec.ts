import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }

test('central guarantee sale, lost response, return and resale retain the fixed mobile balance', async ({
  page,
}) => {
  const email = `guarantee-${randomUUID()}@example.test`,
    password = `K!${randomUUID()}`
  await register(page, email, password)
  const f = await p2Fixture(email)
  await f.commit()
  const previous = (
    await f.db.query('select central_app_tenant_id from platform_settings')
  ).rows[0].central_app_tenant_id
  const config = parseEnv(
    readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'),
  )
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!key) throw new Error('Local public client key missing')
  const api = createClient(
    localTestUrl(
      'NEXT_PUBLIC_SUPABASE_URL',
      config.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    ),
    key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const login = await api.auth.signInWithPassword({ email, password })
  expect(login.error).toBeNull()
  const photo = randomUUID(),
    request = randomUUID(),
    offer = randomUUID(),
    agreement = randomUUID()
  let item: string, seller: string
  try {
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      f.tenant,
    ])
    await f.asActor(f.actor, async () => {
      await f.db.query(
        'select publish_seller_agreement($1,$2,$3,$4,$5,$6,true)',
        [
          f.tenant,
          agreement,
          f.agreement,
          'Synthetic guarantee terms',
          'Synthetic fixed amount',
          'sv',
        ],
      )
      await f.db.query('select reserve_external_item_photo($1,$2,100)', [
        photo,
        'a'.repeat(64),
      ])
      await f.db.query(
        "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
        [`${f.actor}/${photo}.jpg`],
      )
      await f.db.query(
        "select submit_external_item_request($1,$2,'Synthetic guaranteed dress','','good','',30000,'SEK',$3,'SE','seller_amount')",
        [request, f.tenant, [photo]],
      )
      await f.db.query(
        'select issue_external_item_offer($1,$2,$3,null,40000,60000,$4)',
        [f.tenant, offer, request, agreement],
      )
      await f.db.query('select complete_external_item_offer($1,$2,$3,$4,$5)', [
        randomUUID(),
        offer,
        agreement,
        { name: 'Synthetic guarantee seller', email },
        {
          holder: 'Synthetic guarantee seller',
          country: 'SE',
          kind: 'local',
          routing: '8327',
          account: '123456789',
        },
      ])
      const link = (
        await f.db.query(
          'select handover_id,seller_id from external_item_handover_links where offer_id=$1',
          [offer],
        )
      ).rows[0]
      seller = link.seller_id
      await f.db.query("select receive_handover($1,$2,$3,'staff_receipt','')", [
        f.tenant,
        randomUUID(),
        link.handover_id,
      ])
      const guarantee = (
        await f.db.query(
          'select id from external_item_guarantees where offer_id=$1',
          [offer],
        )
      ).rows[0].id
      const prepared = (
        await f.db.query(
          'select prepare_external_item_registration($1,$2) state',
          [f.tenant, guarantee],
        )
      ).rows[0].state
      await f.db.query(
        "insert into storage.objects(bucket_id,name) values('reception-photos',$1),('seller-reception-photos',$1)",
        [`${f.tenant}/${prepared.sessionId}/${photo}.jpg`],
      )
      item = (
        await f.db.query(
          'select register_external_item($1,$2,$3,$4,60000) id',
          [f.tenant, randomUUID(), guarantee, 'Synthetic guaranteed dress'],
        )
      ).rows[0].id
    })
    const balance = async () => {
      const r = await api.rpc('my_seller_payouts_page', {
        p_tenant: f.tenant,
        p_seller: seller!,
        p_offset: 0,
      })
      expect(r.error).toBeNull()
      return Number(r.data.balance.availableOre)
    }
    for (const price of ['300.00', '800.00']) {
      await page.goto(`/intake/items/${item!}`)
      await page
        .getByRole('link', { name: d.sales.markSold, exact: true })
        .click()
      await page.locator(`#price-${item!}`).fill(price)
      await page.getByLabel(d.sales.confirm, { exact: true }).check()
      if (price === '300.00')
        await page.route(
          '**/api/intake',
          async (route) => {
            const response = await route.fetch()
            expect(response.status()).toBe(200)
            await route.abort('failed')
          },
          { times: 1 },
        )
      await page
        .getByRole('button', { name: d.sales.record, exact: true })
        .click()
      if (price === '300.00')
        await page
          .getByRole('button', { name: d.intake.retry, exact: true })
          .click()
      await page.getByRole('link', { name: d.sales.open, exact: true }).click()
      await page.locator('.sale-line-details summary').click()
      await expect(
        page.getByText(d.sales.guaranteeAccountingPending, { exact: false }),
      ).toBeVisible()
      expect(await balance()).toBe(40000)
      if (price === '300.00') {
        await page.locator('.sale-return summary').click()
        await page
          .getByLabel(d.returns.reason, { exact: true })
          .fill('Synthetic customer return')
        await page.locator('.sale-return input[type=checkbox]').check()
        await page
          .getByRole('button', { name: d.returns.record, exact: true })
          .click()
        await expect(page.locator('.sale-line')).toContainText(
          'Synthetic customer return',
        )
        expect(await balance()).toBe(40000)
      } else {
        await expect(page.locator('.sale-line-details')).toContainText(
          `${d.sales.guaranteeCreditThisSale}: 0.00 SEK`,
        )
      }
    }
    const offerRead = await page.request.post(
      '/api/mobile/v1/external-items/offers',
      {
        headers: {
          Authorization: `Bearer ${login.data.session!.access_token}`,
        },
        data: { action: 'read', offerId: offer },
      },
    )
    expect(offerRead.status()).toBe(200)
    const body = await offerRead.json()
    expect(body.guarantee.creditedAt).toBeTruthy()
    expect(body.guarantee.amountOre).toBe('40000')
    await page.goto('/intake/economy')
    await expect(
      page.getByText(d.sales.guaranteeAccountingPending, { exact: true }),
    ).toBeVisible()
    await page.goto('/intake/stock')
    await expect(
      page.getByText(d.sales.guaranteeAccountingPending, { exact: true }),
    ).toBeVisible()
    const credits = (
      await f.db.query(
        "select count(*)::int n,sum(amount_ore)::int amount from seller_ledger_entries where tenant_id=$1 and kind='credit_guarantee'",
        [f.tenant],
      )
    ).rows[0]
    expect(credits).toEqual({ n: 1, amount: 40000 })
    await page.goto('/intake/requests')
    const automation = page.locator('details').filter({
      has: page.locator('summary', {
        hasText: d.externalOffers.guaranteeAutomation.heading,
      }),
    })
    await automation.locator('summary').click()
    await expect(automation).toContainText(
      d.externalOffers.guaranteeAutomation.hint,
    )
    // A historical recipient may retain its queue, but not this activation control.
    await f.db.query('update platform_settings set central_app_tenant_id=null')
    await page.reload()
    await expect(automation).toHaveCount(0)
  } finally {
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      previous,
    ])
    await api.auth.signOut({ scope: 'local' })
    await f.close()
  }
})
