import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import sharp from 'sharp'
import { uploadReceptionPhoto } from '../lib/engine/reception-photos.ts'
import { readSellerPhoto } from '../lib/engine/seller-review-photo.ts'
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
  const sellerId = await rpc('register_seller', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_name: 'TEST Seller',
    p_email: seller.email,
    p_phone: '',
  })
  const session = randomUUID(),
    photoId = randomUUID(),
    sourceId = randomUUID()
  await rpc('create_reception_session', {
    p_tenant: tenant,
    p_id: session,
    p_seller: sellerId,
  })
  const original = await sharp({
    create: { width: 20, height: 12, channels: 3, background: '#145a93' },
  })
    .withExif({ IFD0: { Artist: 'PRIVATE FIXTURE NAME' } })
    .jpeg()
    .toBuffer()
  const input = { tenantId: tenant, sessionId: session, photoId }
  const source = await uploadReceptionPhoto(owner.app, input, original)
  assert.deepEqual(
    await uploadReceptionPhoto(owner.app, input, original),
    source,
  )
  const changed = await sharp({
    create: { width: 20, height: 12, channels: 3, background: '#f00000' },
  })
    .jpeg()
    .toBuffer()
  await assert.rejects(uploadReceptionPhoto(owner.app, input, changed))
  await rpc('save_reception_sources', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: session,
    p_expected: 0,
    p_sources: [
      source,
      {
        id: sourceId,
        kind: 'price-evidence',
        reference: 'TEST',
        observation: 'Fictional 250 SEK',
      },
    ],
  })
  const terms = await rpc('publish_seller_agreement', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_expected_current: null,
    p_title: 'TEST',
    p_body: 'Fictional terms',
    p_language: 'en',
    p_required: false,
  })
  const review = randomUUID()
  await rpc('publish_reception_review', {
    p_tenant: tenant,
    p_request: review,
    p_session: session,
    p_source_revision: 1,
    p_previous: null,
    p_agreement: terms,
    p_expires: new Date(Date.now() + 3600000).toISOString(),
    p_suggestions: {
      metadata: {
        description: {
          value: 'TEST blue image',
          sourceIds: [photoId],
          certainty: 'observed',
        },
      },
      price: {
        currency: 'SEK',
        amount: '250.00',
        rationale: 'Fictional appraisal',
        sourceIds: [sourceId],
      },
      questions: [],
    },
  })
  const capability = randomBytes(32).toString('hex'),
    access = randomUUID()
  await rpc('set_reception_access', {
    p_tenant: tenant,
    p_request: access,
    p_review: review,
    p_previous: null,
    p_hash: createHash('sha256').update(capability).digest('hex'),
  })
  const allowed = client(seller.token, capability),
    path = `${tenant}/${session}/${photoId}.jpg`
  // Hosted Storage authorizes an info request before serving the download.
  // Local downloads alone do not exercise that CDN preflight.
  const info = await allowed.storage.from('seller-reception-photos').info(path)
  assert.ifError(info.error)
  for (const denied of [client(seller.token), client(undefined, capability)]) {
    assert.ok(
      (await denied.storage.from('seller-reception-photos').info(path)).error,
      'info requires both identity and capability',
    )
  }
  assert.ok(
    (
      await allowed.storage
        .from('seller-reception-photos')
        .info(`${tenant}/${session}/${randomUUID()}.jpg`)
    ).error,
    'info cannot resolve another photo',
  )
  const bytes = await readSellerPhoto(allowed, capability, photoId)
  assert.ok(bytes)
  const meta = await sharp(Buffer.from(bytes)).metadata()
  assert.equal(meta.width, 20)
  assert.equal(meta.exif, undefined)
  assert.equal(meta.xmp, undefined)
  assert.equal(meta.icc, undefined)
  assert.equal(
    await readSellerPhoto(client(seller.token), capability, photoId),
    null,
    'header required by real Storage',
  )
  assert.equal(
    await readSellerPhoto(client(owner.token, capability), capability, photoId),
    null,
    'owner cannot impersonate seller through descriptor',
  )
  assert.equal(
    await readSellerPhoto(client(undefined, capability), capability, photoId),
    null,
  )
  assert.ok(
    (await allowed.storage.from('reception-photos').download(source.reference))
      .error,
    'original inaccessible',
  )
  assert.ok(
    (
      await allowed.storage
        .from('seller-reception-photos')
        .createSignedUrl(path, 3600)
    ).error,
    'seller cannot mint persistent signed URL',
  )
  const listing = await allowed.storage
    .from('seller-reception-photos')
    .list(`${tenant}/${session}`)
  assert.ok(
    listing.error || listing.data.length === 0,
    'seller cannot enumerate',
  )
  await db.query(
    "insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values($1,$2,'totp','verified',now(),now())",
    [randomUUID(), seller.uid],
  )
  assert.ok(
    (await allowed.storage.from('seller-reception-photos').info(path)).error,
    'MFA blocks the hosted info preflight',
  )
  assert.equal(
    await readSellerPhoto(allowed, capability, photoId),
    null,
    'MFA denied with same live JWT',
  )
  assert.ok(
    (await allowed.storage.from('seller-reception-photos').download(path))
      .error,
    'MFA also blocks direct Storage',
  )
  await db.query('delete from auth.mfa_factors where user_id=$1', [seller.uid])
  assert.ok(await readSellerPhoto(allowed, capability, photoId))
  await rpc('set_reception_access', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_review: review,
    p_previous: access,
    p_hash: null,
  })
  assert.equal(await readSellerPhoto(allowed, capability, photoId), null)
  assert.ok(
    (await allowed.storage.from('seller-reception-photos').info(path)).error,
    'revocation blocks the hosted info preflight',
  )
  assert.ok(
    (await allowed.storage.from('seller-reception-photos').download(path))
      .error,
    'direct Storage download revoked too',
  )
  console.log(
    'PASS: real Storage derivative read, metadata removal, immutable retry, identity/header/MFA, no originals/list/signing, revocation.',
  )
} finally {
  await db.end()
}
