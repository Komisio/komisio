import { prepareSubmissionReception } from '../lib/engine/submission-reception.ts'
import { quickReceive } from '../lib/engine/quick-intake.ts'
import { readItemPhotos } from '../lib/engine/item-photos.ts'
import { notifySubmissionReview } from '../lib/communications/submission-notification.ts'
import { runSellerAssistance } from '../lib/engine/seller-assistance.ts'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import sharp from 'sharp'
import {
  uploadSellerSubmissionPhoto,
  submitSellerItems,
  readMySubmissions,
  readSubmissionQueue,
  reviewSellerSubmission,
} from '../lib/engine/seller-submissions.ts'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (url !== 'http://127.0.0.1:54321' || !key)
  throw new Error('Requires isolated local Supabase')
const db = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
const client = (token, capability) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        ...(process.env.KOMISIO_SELLER_AI_SERVER_KEY
          ? { 'x-komisio-seller-ai': process.env.KOMISIO_SELLER_AI_SERVER_KEY }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(capability ? { 'x-komisio-review-token': capability } : {}),
      },
    },
  })
await db.connect()
try {
  async function identity(prefix) {
    const app = client(),
      email = `${prefix}-${randomUUID()}@example.test`,
      password = `P!${randomBytes(20).toString('hex')}`
    const signup = await app.auth.signUp({ email, password })
    assert.ifError(signup.error)
    await db.query(
      'update auth.users set email_confirmed_at=now() where id=$1',
      [signup.data.user.id],
    )
    const login = await app.auth.signInWithPassword({ email, password })
    assert.ifError(login.error)
    return {
      app,
      token: login.data.session.access_token,
      uid: signup.data.user.id,
      email,
    }
  }
  const owner = await identity('photo-owner'),
    seller = await identity('photo-seller')
  async function rpc(name, args) {
    const r = await owner.app.rpc(name, args)
    if (r.error) throw new Error(`Fixture operation failed: ${name}`)
    return r.data
  }
  const tenant = await rpc('create_tenant', {
    p_name: 'Photo fixture',
    p_slug: `photo-${randomUUID()}`,
    p_request_id: randomUUID(),
  })
  await rpc('publish_store_profile', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_expected_current: null,
    p_profile: {
      address: { street: '', postalCode: '', city: '', country: 'SE' },
      contact: { email: '', phone: '', website: '' },
      openingHours: [],
      accepts: '',
      concept: '',
      language: 'sv',
    },
  })
  const sellerId = await rpc('register_seller', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_name: 'TEST Seller',
    p_email: seller.email,
    p_phone: '',
  })
  const original = await sharp({
    create: { width: 20, height: 12, channels: 3, background: '#145a93' },
  })
    .withExif({ IFD0: { Artist: 'PRIVATE FIXTURE' } })
    .jpeg()
    .toBuffer()
  const photoId = randomUUID()
  const photo = await uploadSellerSubmissionPhoto(
    seller.app,
    { tenantId: tenant, sellerId, photoId },
    original,
  )
  assert.deepEqual(
    await uploadSellerSubmissionPhoto(
      seller.app,
      { tenantId: tenant, sellerId, photoId },
      original,
    ),
    photo,
  )
  const downloaded = await seller.app.storage
    .from('seller-submission-photos')
    .download(photo.path)
  assert.ifError(downloaded.error)
  assert.equal(
    (await sharp(Buffer.from(await downloaded.data.arrayBuffer())).metadata())
      .exif,
    undefined,
  )
  assert.ok(
    (
      await client()
        .storage.from('seller-submission-photos')
        .download(photo.path)
    ).error,
  )
  const stranger = await identity('submission-stranger')
  assert.ok(
    (
      await stranger.app.storage
        .from('seller-submission-photos')
        .download(photo.path)
    ).error,
  )
  let calls = 0
  const aiCommand = {
    tenantId: tenant,
    sellerId,
    requestId: randomUUID(),
    photos: [photo.path],
  }
  const env = {
    KOMISIO_RECEPTION_AI_PROVIDER: 'openai',
    KOMISIO_RECEPTION_AI_KEY: 'synthetic',
    KOMISIO_RECEPTION_AI_MODEL: 'test-model',
    KOMISIO_RESALE_WEB_SEARCH: 'true',
    KOMISIO_RESALE_WEB_SEARCH_ORE_PER_CALL: '10',
  }
  const provider = async (_url, init) => {
    calls++
    if (JSON.parse(init.body).tools) {
      assert.match(JSON.parse(init.body).input, /Observed model/)
      assert.doesNotMatch(
        JSON.parse(init.body).input,
        /Synthetic jacket suggestion/,
      )
      const sources = [
        {
          url: 'https://example.com/items/1',
          title: 'Blue jacket',
          amount: '100.00',
        },
        {
          url: 'https://example.org/items/2',
          title: 'Similar jacket',
          amount: '200.00',
        },
      ].map((s) => ({
        ...s,
        condition: 'Used',
        status: 'asking',
        soldAt: null,
        country: 'SE',
        currency: 'SEK',
        priceBasis: 'item_only',
      }))
      return Response.json({
        status: 'completed',
        usage: { input_tokens: 100, output_tokens: 40 },
        output: [
          {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'search' },
          },
          ...sources.map((s) => ({
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'open_page', url: s.url },
          })),
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  comparison: {
                    from: '100.00',
                    to: '200.00',
                    basis: 'asking',
                    sources,
                  },
                }),
              },
            ],
          },
        ],
      })
    }
    const context = JSON.parse(JSON.parse(init.body).input[0].content[0].text)
    assert.equal(context.language, 'en')
    assert.equal(context.country, 'SE')
    assert.equal(context.currency, 'SEK')
    return Response.json({
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 40 },
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                description: 'Synthetic jacket suggestion',
                itemFacts: {
                  category: 'jacket',
                  brand: null,
                  model: 'Observed model',
                  articleNumber: null,
                  material: 'wool',
                  size: null,
                  condition: 'used',
                },
                price: null,
                approximatePrice: {
                  from: '60.00',
                  to: '120.00',
                  basis: 'ai_estimate',
                },
                suitability: 'uncertain',
                reason: 'Store review needed',
              }),
            },
          ],
        },
      ],
    })
  }
  const ai = await runSellerAssistance(
    seller.app,
    aiCommand,
    AbortSignal.timeout(10000),
    env,
    provider,
    'en',
  )
  assert.equal(ai.status, 'ready')
  assert.equal(ai.output.indicativePrice, '150.00')
  assert.equal(ai.output.itemFacts.model, 'Observed model')
  assert.equal(ai.output.approximatePrice.basis, 'ai_estimate')
  assert.equal(ai.output.externalComparison.basis, 'asking')
  assert.equal(
    (
      await runSellerAssistance(
        seller.app,
        aiCommand,
        AbortSignal.timeout(10000),
        env,
        provider,
        'en',
      )
    ).status,
    'ready',
  )
  assert.equal(calls, 2)
  const command = {
    tenantId: tenant,
    sellerId,
    requestId: randomUUID(),
    previousId: null,
    assistanceId: aiCommand.requestId,
    description: 'Synthetic jacket',
    photos: [photo.path],
  }
  await Promise.all([
    submitSellerItems(seller.app, command),
    submitSellerItems(seller.app, command),
  ])
  assert.equal(
    (await readMySubmissions(seller.app, { tenantId: tenant, sellerId }))
      .length,
    1,
  )
  assert.equal((await readSubmissionQueue(owner.app, tenant, 1)).rows.length, 1)
  assert.equal(
    (await readMySubmissions(seller.app, { tenantId: tenant, sellerId }))[0]
      .assistance_output.suggestion.externalComparison.sources.length,
    2,
  )
  await assert.rejects(
    readMySubmissions(stranger.app, { tenantId: tenant, sellerId }),
  )
  await reviewSellerSubmission(owner.app, {
    tenantId: tenant,
    requestId: randomUUID(),
    submissionId: command.requestId,
    decision: 'invite',
    note: 'Bring it in',
  })
  assert.equal(
    (await readMySubmissions(seller.app, { tenantId: tenant, sellerId }))[0]
      .decision,
    'invite',
  )
  assert.equal(
    (await readSubmissionQueue(owner.app, tenant, 1)).rows[0]
      .seller_submission_reviews[0].decision,
    'invite',
  )
  const preparation = {
    tenantId: tenant,
    submissionId: command.requestId,
    description: 'Synthetic jacket',
    price: '150.00',
  }
  await assert.rejects(prepareSubmissionReception(stranger.app, preparation))
  const [first, second] = await Promise.all([
    prepareSubmissionReception(owner.app, preparation),
    prepareSubmissionReception(owner.app, preparation),
  ])
  assert.equal(first.sessionId, second.sessionId)
  const linked = await db.query(
    'select * from submission_receptions where submission_id=$1',
    [command.requestId],
  )
  assert.equal(linked.rows.length, 1)
  const source = (
    await db.query(
      'select sources,revision from reception_source_revisions where session_id=$1',
      [first.sessionId],
    )
  ).rows
  assert.equal(source.length, 1)
  assert.equal(source[0].sources.filter((s) => s.kind === 'photo').length, 1)
  assert.equal(
    (
      await db.query('select count(*)::int n from items where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].n,
    0,
  )
  const accepted = await quickReceive(owner.app, {
    tenantId: tenant,
    requestId: randomUUID(),
    sessionId: first.sessionId,
    expectedRevision: 1,
    sellerId,
    facts: { description: 'Synthetic jacket' },
    priceOre: 15000,
  })
  assert.equal(
    (await readItemPhotos(owner.app, tenant, [accepted.itemId]))[0].photos
      .length,
    1,
  )
  assert.equal(
    (await prepareSubmissionReception(owner.app, preparation)).sessionId,
    first.sessionId,
  )
  assert.equal(
    (
      await db.query('select count(*)::int n from items where tenant_id=$1', [
        tenant,
      ])
    ).rows[0].n,
    1,
  )
  // Local-only transport: queue and record the actual notification without contacting a provider.
  process.env.SELLER_EMAIL_DELIVERY = 'manual'
  const reviewId = (
    await db.query(
      'select id from seller_submission_reviews where submission_id=$1',
      [command.requestId],
    )
  ).rows[0].id
  const store = { tenantId: tenant, storeName: 'Photo fixture', locale: 'sv' }
  const currentPolicy = await rpc('current_store_policy', { p_tenant: tenant })
  await rpc('publish_store_policy', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_expected_current: currentPolicy.id,
    p_policy: { ...currentPolicy.policy, automaticSellerNotifications: true },
  })
  assert.equal(
    await notifySubmissionReview(owner.app, store, reviewId),
    'manual',
  )
  await notifySubmissionReview(owner.app, store, reviewId, true)
  await notifySubmissionReview(owner.app, store, reviewId, true)
  const notices = (
    await db.query(
      "select body,status from seller_communications where tenant_id=$1 and template_key='seller.submission_reply'",
      [tenant],
    )
  ).rows
  assert.equal(notices.length, 1)
  assert.equal(notices[0].status, 'manual')
  assert.ok(notices[0].body.includes('/seller/submissions?seller=' + sellerId))
  console.log(
    'PASS: real seller Storage, immutable retries, stripped metadata, private access, submission, queue and review.',
  )
} finally {
  await db.end()
}
