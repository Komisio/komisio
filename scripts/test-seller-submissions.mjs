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
                price: null,
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
  )
  assert.equal(ai.status, 'ready')
  assert.equal(ai.output.externalComparison.basis, 'asking')
  assert.equal(
    (
      await runSellerAssistance(
        seller.app,
        aiCommand,
        AbortSignal.timeout(10000),
        env,
        provider,
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
  await submitSellerItems(seller.app, command)
  await submitSellerItems(seller.app, command)
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
  console.log(
    'PASS: real seller Storage, immutable retries, stripped metadata, private access, submission, queue and review.',
  )
} finally {
  await db.end()
}
