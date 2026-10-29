import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import sharp from 'sharp'
import { changeItemPhoto } from '../lib/engine/item-photos.ts'
import { uploadReceptionPhoto } from '../lib/engine/reception-photos.ts'

// Real local Auth/Storage/RPC regression. Only synthetic fixture stores are
// created; they are hidden and all sessions signed out when the test ends.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (url !== 'http://127.0.0.1:54321' || !key)
  throw new Error('Requires isolated local Supabase')
const db = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
const clients = []
function client(token) {
  const app = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token
      ? { global: { headers: { Authorization: `Bearer ${token}` } } }
      : {}),
  })
  clients.push(app)
  return app
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = secret
    .replace(/=+$/, '')
    .toUpperCase()
    .split('')
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('')
  const secretBytes = Buffer.from(
    bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)),
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', secretBytes).update(counter).digest()
  const offset = digest[19] & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0')
}
await db.connect()
let owner, tenant, visibility
async function rpc(name, args) {
  const result = await owner.app.rpc(name, args)
  if (result.error)
    throw new Error(`Synthetic fixture operation failed: ${name}`)
  return result.data
}
async function visible(value) {
  const next = randomUUID()
  await rpc('set_store_app_visibility', {
    p_tenant: tenant,
    p_id: next,
    p_expected: visibility ?? null,
    p_visible: value,
  })
  visibility = next
}
async function denied(app, photo, reason) {
  const bucket = app.storage.from(photo.bucket)
  assert.ok((await bucket.info(photo.path)).error, `${reason}: info`)
  assert.ok((await bucket.download(photo.path)).error, `${reason}: download`)
}
async function allowed(app, photo) {
  const bucket = app.storage.from(photo.bucket)
  assert.ifError((await bucket.info(photo.path)).error)
  const downloaded = await bucket.download(photo.path)
  assert.ifError(downloaded.error)
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, 20)
  assert.equal(metadata.exif, undefined, 'seller image has no EXIF')
  assert.equal(metadata.xmp, undefined, 'seller image has no XMP')
  assert.equal(metadata.icc, undefined, 'seller image has no ICC')
  return bytes
}
try {
  async function identity(prefix) {
    const user = randomUUID(),
      email = `${prefix}-${user}@example.test`,
      password = randomUUID() + 'aA!3'
    // Auth setup only; domain operations below use their engines.
    await db.query(
      `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','')`,
      [user, email, password],
    )
    await db.query(
      `insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at) values($1,$2::uuid,$2::text,jsonb_build_object('sub',$2::text,'email',$3::text),'email',now(),now())`,
      [randomUUID(), user, email],
    )
    const app = client()
    const login = await app.auth.signInWithPassword({ email, password })
    if (login.error || !login.data.session)
      throw new Error('Synthetic local Auth failed')
    return { app, user, email, token: login.data.session.access_token }
  }
  owner = await identity('catalogue-owner')
  const reader = await identity('catalogue-reader')
  const outsider = await identity('catalogue-outsider')
  tenant = await rpc('create_tenant', {
    p_name: 'Synthetic catalogue Storage test',
    p_slug: `catalogue-storage-${randomUUID()}`,
    p_request_id: randomUUID(),
  })
  await rpc('register_seller', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_name: 'Synthetic reader',
    p_email: reader.email,
    p_phone: '',
  })
  const consignor = await rpc('register_seller', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_name: 'Synthetic consignor',
    p_email: `consignor-${randomUUID()}@example.test`,
    p_phone: '',
  })
  const policy = await rpc('current_store_policy', { p_tenant: tenant })
  await rpc('publish_store_policy', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_expected_current: policy.id,
    p_policy: {
      ...policy.policy,
      vatModeConsignmentPrivate: 'consignment_margin',
      vatModeStoreOwned: 'store_full',
      salePeriodDays: 42,
      markdownSteps: [],
    },
  })
  const session = randomUUID(),
    inheritedId = randomUUID()
  await rpc('create_reception_session', {
    p_tenant: tenant,
    p_id: session,
    p_seller: consignor,
  })
  const bytes = await sharp({
    create: { width: 20, height: 12, channels: 3, background: '#145a93' },
  })
    .withExif({ IFD0: { Artist: 'Synthetic private fixture metadata' } })
    .jpeg()
    .toBuffer()
  const source = await uploadReceptionPhoto(
    owner.app,
    { tenantId: tenant, sessionId: session, photoId: inheritedId },
    bytes,
  )
  await rpc('save_reception_sources', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: session,
    p_expected: 0,
    p_sources: [source],
  })
  const item = await rpc('quick_receive', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: session,
    p_seller: consignor,
    p_expected: 1,
    p_facts: { description: 'Synthetic catalogue coat' },
    p_price_ore: 25000,
  })
  const photoId = randomUUID()
  const changed = await changeItemPhoto(
    owner.app,
    {
      tenantId: tenant,
      itemId: item.itemId,
      requestId: randomUUID(),
      photoId,
      expected: 0,
      action: 'add',
    },
    bytes,
  )
  const staffPhotos = changed.state.photos
  assert.equal(staffPhotos.length, 2)
  const direct = staffPhotos.find((p) => p.id === photoId)
  const original = staffPhotos.find((p) => p.id === inheritedId)
  assert.ok(direct && original)
  const inherited = {
    id: inheritedId,
    bucket: 'seller-reception-photos',
    path: `${tenant}/${session}/${inheritedId}.jpg`,
  }
  const photos = [inherited, direct]
  const originalRead = await owner.app.storage
    .from(original.bucket)
    .download(original.path)
  assert.ifError(originalRead.error)
  assert.ok(
    (await sharp(Buffer.from(await originalRead.data.arrayBuffer())).metadata())
      .exif,
    'fixture original retains its metadata for staff',
  )
  for (const photo of photos) await denied(reader.app, photo, 'hidden store')
  await visible(true)
  const page = await reader.app.rpc('store_catalogue_item', {
    p_tenant: tenant,
    p_item: item.itemId,
  })
  assert.ifError(page.error)
  assert.equal(page.data.photos.length, 2)
  assert.deepEqual(page.data.photos, photos)
  assert.equal(
    page.data.photos[0].id,
    changed.state.defaultPhotoId,
    'default photo stays first',
  )
  await denied(reader.app, original, 'originals stay private even while listed')
  const anon = client()
  for (const photo of photos) {
    assert.deepEqual(
      await allowed(reader.app, photo),
      await allowed(owner.app, photo),
      'seller receives exact safe derivative bytes',
    )
    await denied(outsider.app, photo, 'unrelated identity')
    await denied(anon, photo, 'anonymous')
    const bucket = reader.app.storage.from(photo.bucket)
    assert.ok(
      (await bucket.createSignedUrl(photo.path, 3600)).error,
      'seller cannot sign a URL',
    )
    const signed = await bucket.createSignedUrls([photo.path], 3600)
    assert.ok(
      signed.error || signed.data.every((row) => !row.signedUrl),
      'seller cannot bulk-sign URLs',
    )
    const list = await bucket.list(
      photo.path.slice(0, photo.path.lastIndexOf('/')),
    )
    assert.ok(
      list.error || list.data.length === 0,
      'seller cannot enumerate storage objects',
    )
  }
  // A legacy upload with no pre-existing derivative is omitted, not exposed or
  // backfilled by a read. Deliberately upload only the original fixture bytes.
  const legacySession = randomUUID(),
    legacyId = randomUUID()
  await rpc('create_reception_session', {
    p_tenant: tenant,
    p_id: legacySession,
    p_seller: consignor,
  })
  const legacyPath = `${tenant}/${legacySession}/${legacyId}.jpg`
  const legacyUpload = await owner.app.storage
    .from('reception-photos')
    .upload(legacyPath, bytes, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '0',
    })
  assert.ifError(legacyUpload.error)
  await rpc('save_reception_sources', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: legacySession,
    p_expected: 0,
    p_sources: [
      { id: legacyId, kind: 'photo', reference: legacyPath, observation: '' },
    ],
  })
  const legacyItem = await rpc('quick_receive', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_session: legacySession,
    p_seller: consignor,
    p_expected: 1,
    p_facts: { description: 'Synthetic legacy photo item' },
    p_price_ore: 25000,
  })
  const legacyDetail = await reader.app.rpc('store_catalogue_item', {
    p_tenant: tenant,
    p_item: legacyItem.itemId,
  })
  assert.ifError(legacyDetail.error)
  assert.deepEqual(legacyDetail.data.photos, [])
  await denied(
    reader.app,
    { bucket: 'reception-photos', path: legacyPath },
    'legacy original is not a fallback',
  )
  // Enroll and verify a real factor; an old aal1 token must stop working.
  const oldSession = client(reader.token)
  const factor = await reader.app.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Synthetic catalogue test',
  })
  if (factor.error || !factor.data)
    throw new Error('Synthetic MFA enrollment failed')
  const verified = await reader.app.auth.mfa.challengeAndVerify({
    factorId: factor.data.id,
    code: totp(factor.data.totp.secret),
  })
  if (verified.error || !verified.data)
    throw new Error('Synthetic MFA verification failed')
  const verifiedReader = client(verified.data.access_token)
  for (const photo of photos) {
    await denied(oldSession, photo, 'MFA required')
    await allowed(verifiedReader, photo)
  }
  await visible(false)
  for (const photo of photos) {
    await denied(verifiedReader, photo, 'visibility revoked')
    await allowed(owner.app, photo)
  }
  await visible(true)
  await changeItemPhoto(owner.app, {
    tenantId: tenant,
    itemId: item.itemId,
    requestId: randomUUID(),
    photoId,
    expected: changed.state.revision,
    action: 'remove',
  })
  await denied(verifiedReader, direct, 'photo detached')
  await allowed(verifiedReader, inherited)
  await rpc('record_sale', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_provider: 'manual',
    p_external_id: `synthetic-${randomUUID()}`,
    p_occurred_at: new Date().toISOString(),
    p_currency: 'SEK',
    p_lines: [{ itemId: item.itemId, priceOre: 25000 }],
  })
  await denied(verifiedReader, inherited, 'item sold')
  console.log(
    'PASS: real local Storage metadata-free item/inherited derivatives and exact bytes; originals remain private, missing derivative omitted; anonymous/foreign/MFA denial; signing, bulk signing and listing denied; hiding/detaching/selling revoke subsequent reads; staff original access unchanged. Synthetic local fixtures only.',
  )
} finally {
  try {
    if (tenant) await visible(false)
  } finally {
    await Promise.all(clients.map((app) => app.auth.signOut().catch(() => {})))
    await db.end()
  }
}
