import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { locales } from '../i18n'
import { renderSellerMessage } from '../communications/templates'
import { sendSellerEmailWithId } from '../platform/seller-email'

const candidate = z.strictObject({
  itemId: z.uuid(),
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  cycleId: z.uuid(),
  kind: z.enum(['period_ending', 'period_ended']),
  dueAt: z.iso.datetime({ offset: true }),
  periodEnd: z.iso.datetime({ offset: true }),
  recipient: z.string().min(3).max(254),
  locale: z.enum(locales),
  policyId: z.uuid().nullable(),
  preferenceId: z.uuid().nullable(),
  storeName: z.string().min(1).max(120),
  sellerName: z.string().min(1).max(120),
  itemLabel: z.string().min(1).max(120),
})
const page = z.object({
  candidates: z.array(candidate).max(80),
  checked: z.number().int().min(0).max(40),
  wrapped: z.boolean(),
})

/** A successful claim is permission for one transport call, never a retry token. */
export async function runPeriodNotices(
  client: SupabaseClient,
  env: Record<string, string | undefined> = process.env,
  send = sendSellerEmailWithId,
  now = Date.now,
) {
  const deadline = now() + 180000
  let attempted = 0,
    checked = 0,
    failed = false
  for (let pages = 0; pages < 100; pages++) {
    if (now() >= deadline)
      return { attempted, checked, failed, complete: false }
    const read = await client.rpc('period_notice_candidates')
    if (read.error) throw new Error('PERIOD_NOTICE_SCAN_FAILED')
    const batch = page.parse(read.data)
    checked += batch.checked
    for (const facts of batch.candidates) {
      if (now() >= deadline)
        return { attempted, checked, failed, complete: false }
      const rendered = renderSellerMessage(facts.kind, facts.locale, {
        storeName: facts.storeName,
        sellerName: facts.sellerName,
        itemLabel: facts.itemLabel,
        date: facts.periodEnd,
      })
      const id = randomUUID()
      const claim = await client.rpc('claim_period_notice', {
        p_id: id,
        p_facts: facts,
        p_locale: rendered.locale,
        p_subject: rendered.subject,
        p_body: rendered.body,
      })
      // A lost response may follow a committed claim. Do not try to recover send
      // permission; the database excludes that cycle on every future scan.
      if (claim.error) {
        failed = true
        continue
      }
      if (claim.data === null) continue
      if (claim.data !== id) throw new Error('PERIOD_NOTICE_CLAIM_MISMATCH')
      attempted++
      let delivery: Awaited<ReturnType<typeof sendSellerEmailWithId>>
      try {
        delivery = await send(
          {
            communicationId: id,
            to: facts.recipient,
            subject: rendered.subject,
            text: rendered.body,
          },
          env,
        )
      } catch {
        delivery = { status: 'unconfirmed', providerMessageId: '' }
      }
      const result = await client.rpc('finish_period_notice', {
        p_id: id,
        p_status: delivery.status,
        p_provider_message_id: delivery.providerMessageId,
      })
      if (result.error || result.data !== id) failed = true
    }
    if (batch.wrapped) return { attempted, checked, failed, complete: true }
  }
  return { attempted, checked, failed, complete: false }
}

export async function handlePeriodNoticeCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runPeriodNotices,
) {
  const reply = (status: number, body: object) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  const email = env.KOMISIO_PERIOD_NOTICES_EMAIL,
    password = env.KOMISIO_PERIOD_NOTICES_PASSWORD,
    secret = env.CRON_SECRET
  if (
    env.KOMISIO_INTAKE_ENABLED !== 'true' ||
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
  let outcome: Awaited<ReturnType<typeof run>> | undefined
  let failed = false
  try {
    const signed = await client.auth.signInWithPassword({ email, password })
    if (signed.error) throw new Error('AUTH_FAILED')
    outcome = await run(client, env)
  } catch {
    failed = true
  } finally {
    try {
      if ((await client.auth.signOut({ scope: 'local' })).error) failed = true
    } catch {
      failed = true
    }
  }
  if (failed || !outcome || outcome.failed)
    return reply(500, { error: 'PERIOD_NOTICES_FAILED' })
  return reply(200, {
    ok: true,
    attempted: outcome.attempted,
    checked: outcome.checked,
    catchingUp: !outcome.complete,
  })
}
