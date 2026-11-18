import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'

test('mobile photo copies retain server-verified AI weight after draft cleanup', async ({
  page,
}) => {
  const email = `photo-weight-${randomUUID()}@example.test`,
    password = `K!${randomUUID()}`
  await register(page, email, password)
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
  const token = login.data.session!.access_token
  const f = await p2Fixture(email)
  await f.commit()
  const previous = (
    await f.db.query('select central_app_tenant_id from platform_settings')
  ).rows[0]
  const runtime = (
    await f.db.query(
      'select key_hash from komisio_private.seller_ai_runtime where singleton',
    )
  ).rows[0]
  const capability = 'a'.repeat(64)
  const headers = { Authorization: `Bearer ${token}` }
  try {
    await f.db.query('update platform_settings set central_app_tenant_id=$1', [
      f.tenant,
    ])
    await f.db.query(
      'insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,$1) on conflict(singleton) do update set key_hash=excluded.key_hash',
      [createHash('sha256').update(capability).digest('hex')],
    )
    const original = randomUUID(),
      copy = randomUUID(),
      analysis = randomUUID(),
      requestId = randomUUID()
    const bytes = await sharp({
      create: { width: 24, height: 32, channels: 3, background: '#368060' },
    })
      .png()
      .toBuffer()
    const upload = (id: string) =>
      page.request.post(`/api/mobile/v1/external-items/photos?photoId=${id}`, {
        headers: { ...headers, 'Content-Type': 'image/png' },
        data: bytes,
      })
    expect((await upload(original)).status()).toBe(200)
    // Use a synthetic provider result through the real capability-bound engine.
    // No external AI or carrier request is made by this test.
    await f.asActor(f.actor, async () => {
      await f.db.query("select set_config('request.headers',$1,true)", [
        JSON.stringify({ 'x-komisio-seller-ai': capability }),
      ])
      await f.db.query(
        "select begin_external_photo_analysis($1,$2,$3,'synthetic','sv','central-photo-v2-weight')",
        [analysis, f.tenant, [original]],
      )
      await f.db.query(
        'select complete_external_photo_analysis($1,$2,100,10)',
        [
          analysis,
          {
            description: 'Synthetic dress',
            brand: null,
            condition: 'good',
            notes: '',
            estimatedWeightG: 350,
          },
        ],
      )
    })
    expect((await upload(copy)).status()).toBe(200)
    expect((await upload(copy)).status()).toBe(200)
    const photos = (
      await f.db.query(
        'select sha256,content_verified_at from external_item_photos where id=any($1::uuid[])',
        [[original, copy]],
      )
    ).rows
    expect(photos).toHaveLength(2)
    expect(photos[0].sha256).toBe(photos[1].sha256)
    expect(
      photos.every(
        (p: { content_verified_at: unknown }) => p.content_verified_at,
      ),
    ).toBe(true)
    const call = (data: object) =>
      page.request.post('/api/mobile/v1/external-items', { headers, data })
    expect(
      (await call({ action: 'discardPhoto', photoId: original })).status(),
    ).toBe(200)
    const command = {
      action: 'submit',
      requestId,
      tenantId: f.tenant,
      description: 'Synthetic dress',
      brand: '',
      condition: 'good',
      notes: '',
      desiredPriceOre: null,
      currency: 'SEK',
      photos: [copy],
      senderCountry: 'SE',
      priceBasis: 'seller_amount',
    }
    const submitted = await call(command)
    expect(submitted.status()).toBe(200)
    expect(await submitted.json()).toEqual({ id: requestId })
    expect((await call(command)).status()).toBe(200)
    const saved = (
      await f.db.query(
        'select weight_analysis_id,komisio_private.external_item_selection_weight(id) grams from external_item_requests where id=$1',
        [requestId],
      )
    ).rows[0]
    expect(saved).toEqual({ weight_analysis_id: analysis, grams: 350 })
    expect(
      (await call({ action: 'discardPhoto', photoId: copy })).status(),
    ).toBe(409)
    expect(
      (
        await f.db.query(
          'select count(*)::integer count from external_item_requests where id=$1',
          [requestId],
        )
      ).rows[0].count,
    ).toBe(1)
  } finally {
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
