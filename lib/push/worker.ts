import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { locales } from '../i18n'
import { renderSellerPush } from './copy'
import { pushClaim, readExpoReceipts, sendExpoPush } from './transport'

const candidates = z
  .array(
    z.strictObject({
      id: z.uuid(),
      tenantId: z.uuid(),
      sellerId: z.uuid().nullable(),
      itemId: z.guid().nullable(),
      requestId: z.uuid().nullable().optional(),
      ownerId: z.uuid().nullable().optional(),
      offerId: z.uuid().nullable().optional(),
      kind: z.enum([
        'item_registered',
        'item_sold',
        'external_item_offered',
        'external_item_declined',
      ]),
      createdAt: z.iso.datetime({ offset: true }),
      locale: z.enum(locales),
      storeName: z.string().max(120),
      itemLabel: z.string().max(120),
    }),
  )
  .max(50)
const receipts = z
  .array(
    z.strictObject({
      id: z.uuid(),
      ticketId: z.uuid(),
      claimedAt: z.iso.datetime({ offset: true }),
    }),
  )
  .max(100)

export async function runSellerPush(
  client: SupabaseClient,
  env: Record<string, string | undefined> = process.env,
  send = sendExpoPush,
  readReceipts = readExpoReceipts,
  now = Date.now,
) {
  let attempted = 0,
    receiptCount = 0,
    failed = false
  const deadline = now() + 210000
  const expired = await client.rpc('expire_seller_push_claims')
  if (expired.error) throw new Error('PUSH_CLEANUP_FAILED')
  const pending = await client.rpc('seller_push_receipts')
  if (pending.error) throw new Error('PUSH_RECEIPTS_FAILED')
  const batch = receipts.parse(pending.data)
  if (batch.length) {
    try {
      const outcomes = await readReceipts(
        batch.map((r) => r.ticketId),
        env,
      )
      for (const r of batch) {
        const outcome = outcomes.get(r.ticketId)
        if (!outcome) {
          failed = true
          continue
        }
        const expiredReceipt =
          outcome.status === 'pending' &&
          now() - Date.parse(r.claimedAt) >= 86400000
        const finished = await client.rpc('complete_seller_push_receipt', {
          p_id: r.id,
          p_status: expiredReceipt ? 'unconfirmed' : outcome.status,
          p_error: expiredReceipt ? 'RECEIPT_UNAVAILABLE' : outcome.error,
        })
        if (finished.error || finished.data !== r.id) failed = true
        else receiptCount++
      }
    } catch {
      failed = true
    }
  }
  for (let page = 0; page < 10 && now() < deadline; page++) {
    const read = await client.rpc('seller_push_candidates')
    if (read.error) throw new Error('PUSH_QUEUE_FAILED')
    const rows = candidates.parse(read.data)
    if (!rows.length) break
    let progressed = false
    for (const c of rows) {
      if (now() >= deadline) break
      const rendered = renderSellerPush(
        c.kind,
        c.locale,
        c.itemLabel,
        c.storeName,
      )
      const claimed = await client.rpc('claim_seller_push', {
        p_id: c.id,
        p_locale: c.locale,
        p_subject: rendered.title,
        p_body: rendered.body,
      })
      // A missing reply can follow a committed claim. Never infer send permission.
      if (claimed.error) {
        failed = true
        continue
      }
      if (claimed.data === null) {
        progressed = true
        continue
      }
      const claim = pushClaim.parse(claimed.data)
      if (
        claim.id !== c.id ||
        claim.tenantId !== c.tenantId ||
        claim.sellerId !== c.sellerId ||
        claim.itemId !== c.itemId ||
        (claim.requestId ?? null) !== (c.requestId ?? null) ||
        (claim.ownerId ?? null) !== (c.ownerId ?? null) ||
        (claim.offerId ?? null) !== (c.offerId ?? null) ||
        claim.kind !== c.kind
      )
        throw new Error('PUSH_CLAIM_MISMATCH')
      attempted++
      progressed = true
      let outcome: Awaited<ReturnType<typeof sendExpoPush>>
      try {
        outcome = await send(claim, env)
      } catch {
        outcome = {
          status: 'unconfirmed',
          ticket: '',
          error: 'TRANSPORT_UNCONFIRMED',
        }
      }
      const finished = await client.rpc('finish_seller_push', {
        p_id: claim.id,
        p_status: outcome.status,
        p_ticket: outcome.ticket,
        p_error: outcome.error,
      })
      if (finished.error || finished.data !== claim.id) failed = true
    }
    if (!progressed || rows.length < 50) break
  }
  return { attempted, receipts: receiptCount, failed }
}

export async function handleSellerPushCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runSellerPush,
) {
  const reply = (status: number, body: object) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  const email = env.KOMISIO_PUSH_WORKER_EMAIL,
    password = env.KOMISIO_PUSH_WORKER_PASSWORD,
    secret = env.CRON_SECRET
  if (
    env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    env.KOMISIO_PUSH_ENABLED !== 'true' ||
    !email ||
    !password ||
    !secret ||
    secret.length < 16 ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return reply(404, { error: 'NOT_FOUND' })
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return reply(401, { error: 'AUTH_REQUIRED' })
  const client = makeClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    },
  )
  let result: Awaited<ReturnType<typeof run>> | undefined
  let failed = false
  try {
    const signed = await client.auth.signInWithPassword({ email, password })
    if (signed.error) throw new Error('AUTH_FAILED')
    result = await run(client, env)
  } catch {
    failed = true
  } finally {
    try {
      if ((await client.auth.signOut({ scope: 'local' })).error) failed = true
    } catch {
      failed = true
    }
  }
  if (failed || !result || result.failed)
    return reply(500, { error: 'PUSH_RUN_FAILED' })
  return reply(200, {
    ok: true,
    attempted: result.attempted,
    receipts: result.receipts,
  })
}
