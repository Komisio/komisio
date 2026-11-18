import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { receptionDerivative } from '../../lib/media/reception-image'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'

test('guest AI transfers to the same verified Apple account without primary email or store membership', async ({
  page,
}) => {
  const config = parseEnv(
    readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'),
  )
  const url = localTestUrl(
    'NEXT_PUBLIC_SUPABASE_URL',
    config.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  )
  const key = config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!key) throw new Error('Local test configuration missing')
  const { Client } = createRequire(import.meta.url)('pg')
  const admin = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await admin.connect()
  async function identity() {
    const api = createClient(url, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const email = `guest-photo-${randomUUID()}@example.test`,
      password = `Test!${randomUUID()}`
    const signup = await api.auth.signUp({ email, password })
    expect(signup.error).toBeNull()
    await admin.query(
      'update auth.users set email_confirmed_at=now() where email=$1',
      [email],
    )
    const login = await api.auth.signInWithPassword({ email, password })
    expect(login.error).toBeNull()
    return {
      email,
      user: login.data.user!.id,
      token: login.data.session!.access_token,
    }
  }
  const owner = await identity(),
    seller = await identity()
  await admin.end()
  const f = await p2Fixture(owner.email)
  await f.commit()
  const previous = (
    await f.db.query('select central_app_tenant_id from platform_settings')
  ).rows[0]
  const runtime = (
    await f.db.query(
      'select key_hash from komisio_private.seller_ai_runtime where singleton',
    )
  ).rows[0]
  const serverKey = 'a'.repeat(64),
    capability = 'b'.repeat(64)
  const hash = (v: string | Buffer) =>
    createHash('sha256').update(v).digest('hex')
  const analysis = randomUUID(),
    guestPhoto = randomUUID(),
    photo = randomUUID(),
    requestId = randomUUID(),
    agreement = randomUUID()
  const headers = { Authorization: `Bearer ${seller.token}` }
  try {
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      f.tenant,
    ])
    await f.db.query(
      'insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,$1) on conflict(singleton) do update set key_hash=excluded.key_hash',
      [hash(serverKey)],
    )
    await f.asActor(owner.user, () =>
      f.db.query(
        "select publish_seller_agreement($1,$2,$3,'Synthetic terms','Synthetic guest terms','sv',true)",
        [f.tenant, agreement, f.agreement],
      ),
    )
    // Reproduce a linked provider on a former phone account. No external Apple,
    // OpenAI or carrier call is made; the real HTTP/RLS paths remain in use.
    await f.db.query("update auth.users set email='' where id=$1", [
      seller.user,
    ])
    await f.db.query(
      "insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at,last_sign_in_at) values($1,$2,$3,'apple',$4,now(),now(),now())",
      [
        randomUUID(),
        seller.user,
        randomUUID(),
        { email: seller.email, email_verified: true, sub: randomUUID() },
      ],
    )
    const bytes = await sharp({
      create: { width: 32, height: 48, channels: 3, background: '#368060' },
    })
      .jpeg()
      .toBuffer()
    const normalized = await receptionDerivative(bytes)
    const usersBefore = (
      await f.db.query('select count(*)::integer n from auth.users')
    ).rows[0].n
    await f.db.query('begin')
    await f.db.query('set local role anon')
    await f.db.query(
      'select set_config(\'request.jwt.claims\',\'{"role":"anon"}\',true)',
    )
    await f.db.query("select set_config('request.headers',$1,true)", [
      JSON.stringify({ 'x-komisio-seller-ai': serverKey }),
    ])
    await f.db.query(
      "select begin_guest_photo_analysis($1,$2,$3,$4,$5,$6,'sv','synthetic',now())",
      [
        analysis,
        f.tenant,
        hash(capability),
        hash(randomUUID()),
        hash(bytes),
        [guestPhoto],
      ],
    )
    await f.db.query(
      'select complete_guest_photo_analysis($1,$2,$3,$4,100,10)',
      [
        analysis,
        hash(capability),
        JSON.stringify([hash(normalized)]),
        {
          description: 'Synthetic dress',
          brand: null,
          condition: 'good',
          notes: '',
          estimatedWeightG: 350,
        },
      ],
    )
    await f.db.query('commit')

    const guestRead = { action: 'read', requestId: analysis, token: capability }
    const read = await page.request.post(
      '/api/mobile/v1/external-items/guest-assistance',
      { data: guestRead },
    )
    expect(read.status(), await read.text()).toBe(200)
    expect(read.headers()['cache-control']).toContain('no-store')
    expect(await read.json()).toMatchObject({
      result: {
        id: analysis,
        status: 'ready',
        output: { description: 'Synthetic dress' },
      },
    })
    expect((await read.json()).result.output).not.toHaveProperty(
      'estimatedWeightG',
    )
    const wrong = await page.request.post(
      '/api/mobile/v1/external-items/guest-assistance',
      { data: { ...guestRead, token: 'c'.repeat(64) } },
    )
    expect(await wrong.json()).toEqual({ result: null })
    const forbidden = await page.request.post(
      '/api/mobile/v1/external-items/guest-assistance',
      { headers: { Origin: 'https://untrusted.example' }, data: guestRead },
    )
    expect(forbidden.status()).toBe(403)
    expect(
      (await f.db.query('select count(*)::integer n from auth.users')).rows[0]
        .n,
    ).toBe(usersBefore)
    expect(
      (
        await f.db.query(
          'select count(*)::integer n from external_item_requests where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)

    const uploadUrl = `/api/mobile/v1/external-items/photos?photoId=${photo}`
    const identity = await page.request.get(`${url}/auth/v1/user`, {
      headers: { ...headers, apikey: key },
    })
    expect(identity.status(), await identity.text()).toBe(200)
    expect(await identity.json()).toMatchObject({ id: seller.user, email: '' })
    const anonymousUpload = await page.request.post(uploadUrl, {
      headers: { 'Content-Type': 'image/jpeg' },
      data: bytes,
    })
    expect(anonymousUpload.status()).toBe(401)
    const upload = await page.request.post(uploadUrl, {
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
      data: bytes,
    })
    expect(upload.status(), await upload.text()).toBe(200)
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
    const command = {
      action: 'submit',
      requestId,
      tenantId: f.tenant,
      description: 'My edited dress',
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
      guestAnalysis: { id: analysis, token: capability },
    }
    const anonymousSubmit = await page.request.post(
      '/api/mobile/v1/external-items',
      { data: command },
    )
    expect(anonymousSubmit.status()).toBe(401)
    for (let retry = 0; retry < 2; retry++) {
      const sent = await page.request.post('/api/mobile/v1/external-items', {
        headers,
        data: command,
      })
      expect(sent.status(), await sent.text()).toBe(200)
      expect(await sent.json()).toEqual({ id: requestId })
    }
    const saved = (
      await f.db.query(
        'select owner_id,description,komisio_private.external_item_selection_weight(id) grams from external_item_requests where id=$1',
        [requestId],
      )
    ).rows[0]
    expect(saved).toEqual({
      owner_id: seller.user,
      description: 'My edited dress',
      grams: 350,
    })
    expect(
      (
        await f.db.query(
          'select count(*)::integer n from tenant_members where user_id=$1',
          [seller.user],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await f.db.query(
          "select count(*)::integer n from usage_events where tenant_id=$1 and feature='reception_assistance'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::integer n from external_photo_ai_attempts where guest_analysis_id=$1',
          [analysis],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.db.query('rollback')
    await f.db.query('update auth.users set email=$1 where id=$2', [
      seller.email,
      seller.user,
    ])
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      previous.central_app_tenant_id,
    ])
    if (runtime)
      await f.db.query(
        'update komisio_private.seller_ai_runtime set key_hash=$1 where singleton',
        [runtime.key_hash],
      )
    else
      await f.db.query(
        'delete from komisio_private.seller_ai_runtime where singleton',
      )
    await f.close()
  }
})
