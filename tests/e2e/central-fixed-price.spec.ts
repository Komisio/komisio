import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createServerClient } from '@supabase/ssr'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'
import d from '../../messages/sv.json' with { type: 'json' }

test('fixed seller amount is submitted once and staff approves a seller group without counteroffers', async ({
  page,
  baseURL,
}) => {
  const config = parseEnv(
    readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'),
  )
  const url = localTestUrl(
    'NEXT_PUBLIC_SUPABASE_URL',
    config.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  )
  const key = config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!key || !baseURL) throw new Error('Local test configuration missing')
  const email = `fixed-${randomUUID()}@example.test`,
    password = `Test!${randomUUID()}`
  const cookies: { name: string; value: string; url: string }[] = []
  const api = createServerClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (values) => {
        cookies.push(
          ...values.map((v) => ({
            name: v.name,
            value: v.value,
            url: baseURL!,
          })),
        )
      },
    },
  })
  const signup = await api.auth.signUp({ email, password })
  expect(signup.error).toBeNull()
  const { Client } = createRequire(import.meta.url)('pg')
  const admin = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await admin.connect()
  await admin.query(
    'update auth.users set email_confirmed_at=now() where email=$1',
    [email],
  )
  await admin.end()
  const login = await api.auth.signInWithPassword({ email, password })
  expect(login.error).toBeNull()
  await page.context().addCookies(cookies)
  const f = await p2Fixture(email)
  await f.commit()
  const prior = (
    await f.db.query('select central_app_tenant_id from platform_settings')
  ).rows[0].central_app_tenant_id
  const agreement = randomUUID(),
    photo = randomUUID(),
    requests = [randomUUID(), randomUUID()]
  const headers = {
    Authorization: `Bearer ${login.data.session!.access_token}`,
  }
  try {
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      f.tenant,
    ])
    await f.asActor(f.actor, async () => {
      await f.db.query(
        "select publish_seller_agreement($1,$2,$3,'Synthetic terms','Synthetic fixed terms','sv',true)",
        [f.tenant, agreement, f.agreement],
      )
      await f.db.query('select reserve_external_item_photo($1,$2,100)', [
        photo,
        'a'.repeat(64),
      ])
      await f.db.query(
        "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
        [`${f.actor}/${photo}.jpg`],
      )
    })
    const profile = await page.request.post(
      '/api/mobile/v1/external-items/profile',
      {
        headers,
        data: {
          action: 'save',
          requestId: randomUUID(),
          tenantId: f.tenant,
          agreementVersionId: agreement,
          expectedRevision: -1,
          address: { street: 'Test 1', postalCode: '12345', city: 'Teststad' },
          contact: {
            firstName: 'Alex',
            lastName: 'Example',
            phone: '+46700000000',
          },
          acceptAgreement: true,
        },
      },
    )
    expect(profile.status(), await profile.text()).toBe(200)
    for (const [n, requestId] of requests.entries()) {
      const sent = await page.request.post('/api/mobile/v1/external-items', {
        headers,
        data: {
          action: 'submit',
          requestId,
          tenantId: f.tenant,
          description: `Synthetic dress ${n + 1}`,
          brand: '',
          condition: 'good',
          notes: '',
          desiredPriceOre: '60000',
          currency: 'SEK',
          senderCountry: 'SE',
          priceBasis: 'seller_amount',
          approvalMode: 'fixed',
          agreementVersionId: agreement,
          photos: [photo],
        },
      })
      expect(sent.status(), await sent.text()).toBe(200)
    }
    await page.route('**/api/intake/requests/photos?*', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDLsAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    await page.goto('/intake/requests')
    await expect(
      page.getByRole('heading', { name: 'Alex Example' }),
    ).toBeVisible()
    await page
      .getByRole('checkbox', {
        name: d.externalOffers.fixed.select.replace(
          '{item}',
          'Synthetic dress 1',
        ),
      })
      .check()
    await page
      .getByRole('checkbox', {
        name: d.externalOffers.fixed.select.replace(
          '{item}',
          'Synthetic dress 2',
        ),
      })
      .check()
    await expect(
      page.getByText(d.externalOffers.fixed.weightLimit),
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: d.externalOffers.fixed.approveBook,
        exact: true,
      }),
    ).toBeDisabled()
    const prices = page.getByLabel(d.externalOffers.salePrice, { exact: true })
    await expect(prices).toHaveCount(2)
    await prices.nth(0).fill('1000')
    await prices.nth(1).fill('1200')
    await page
      .getByRole('button', {
        name: d.externalOffers.fixed.approve,
        exact: true,
      })
      .click()
    await expect
      .poll(async () =>
        Number(
          (
            await f.db.query(
              'select count(*) n from external_item_offer_responses a join external_item_offers o on o.id=a.offer_id where o.request_id=any($1) and a.accepted',
              [requests],
            )
          ).rows[0].n,
        ),
      )
      .toBe(2)
    await expect(
      page.getByRole('button', { name: d.externalOffers.send, exact: true }),
    ).toHaveCount(0)
    const offers = (
      await f.db.query(
        'select id,seller_amount_ore::text from external_item_offers where request_id=any($1)',
        [requests],
      )
    ).rows
    expect(
      offers.every(
        (o: { seller_amount_ore: string }) => o.seller_amount_ore === '60000',
      ),
    ).toBe(true)
    const shipping = await page.request.post(
      '/api/mobile/v1/external-items/shipping',
      { headers, data: { action: 'read', offerId: offers[0].id, protocol: 2 } },
    )
    expect(shipping.status()).toBe(200)
    expect(await shipping.json()).toMatchObject({
      staffManaged: true,
      parcel: null,
    })
    await page
      .getByRole('link', { name: d.externalOffers.fixed.allItems })
      .click()
    await expect(page).toHaveURL(new RegExp(`owner=${f.actor}`))
    await page.screenshot({
      path: 'private/central-fixed-price-desktop.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: 'private/central-fixed-price-mobile.png',
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      prior,
    ])
    await f.close()
  }
})
