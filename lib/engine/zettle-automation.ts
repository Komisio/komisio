import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { automationIdentity, acceptAutomationGrants } from './automation'
import {
  connectedPilotClient,
  pilotEnvironment,
  pilotAvailable,
} from '../../extensions/zettle/auth'
import { mapZettlePage } from '../../extensions/zettle/purchase'

const jobSchema = z.object({
  id: z.guid(),
  windowId: z.uuid().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  cursor: z.string().max(1000).nullable(),
  currency: z.string(),
})
export const automaticPullStatus = z.object({
  id: z.guid(),
  at: z.string(),
  outcome: z.enum(['started', 'complete', 'received', 'waiting', 'failed']),
  received: z.number().int().min(0).max(100),
})
export async function readAutomaticPullStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const result = await client.rpc('zettle_automatic_pull_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error?.code === 'PGRST202') return { available: false, run: null }
  if (result.error) throw new Error('ZETTLE_READ_FAILED')
  return {
    available: true,
    run: automaticPullStatus.nullable().parse(result.data),
  }
}

export async function runAutomaticZettlePull(
  client: SupabaseClient,
  tenantId: string,
  env: Record<string, string | undefined>,
  factory = connectedPilotClient,
) {
  const pilot = pilotEnvironment(env)
  if (!pilotAvailable(tenantId, pilot) || !pilot.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  const prepared = await client.rpc('prepare_zettle_automatic_pull', {
    p_tenant: tenantId,
    p_merchant: pilot.ZETTLE_MERCHANT_ID,
  })
  if (prepared.error) throw new Error('ZETTLE_PREPARE_FAILED')
  if (!prepared.data) return
  const job = jobSchema.parse(prepared.data)
  let outcome = 'waiting'
  try {
    if (job.windowId) {
      if (!job.startDate || !job.endDate)
        throw new Error('ZETTLE_WINDOW_INVALID')
      const transport = await factory(tenantId, pilot, {
        startDate: new Date(job.startDate).toISOString(),
        endDate: new Date(job.endDate).toISOString(),
      })
      const page = mapZettlePage(
        await transport.fetchPage({
          cursor: job.cursor,
          signal: AbortSignal.timeout(15000),
        }),
        job.cursor,
        job.currency,
      )
      const result = await client.rpc('record_zettle_pull_page', {
        p_tenant: tenantId,
        p_id: job.id,
        p_window: job.windowId,
        p_before: job.cursor,
        p_after: page.nextCursor,
        p_purchases: page.purchases,
      })
      if (result.error) throw new Error('ZETTLE_RECORD_FAILED')
      outcome = page.purchases.length === 0 ? 'complete' : 'received'
    }
  } catch {
    await client.rpc('finish_zettle_automatic_pull', {
      p_tenant: tenantId,
      p_id: job.id,
      p_outcome: 'failed',
    })
    throw new Error('ZETTLE_AUTOMATION_FAILED')
  }
  const finished = await client.rpc('finish_zettle_automatic_pull', {
    p_tenant: tenantId,
    p_id: job.id,
    p_outcome: outcome,
  })
  if (finished.error) throw new Error('ZETTLE_AUTOMATION_FAILED')
}

export async function handleZettleCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runAutomaticZettlePull,
) {
  const reply = (status: number, body: object) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  const identity = automationIdentity(env)
  const secret = env.CRON_SECRET
  if (
    env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    !identity ||
    !secret ||
    secret.length < 16 ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return reply(404, { error: 'NOT_FOUND' })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
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
    },
  )
  let failed = false
  try {
    const signed = await client.auth.signInWithPassword(identity)
    if (signed.error) throw new Error('AUTH_FAILED')
    await acceptAutomationGrants(client)
    const tenants = await client.rpc('zettle_automation_tenants')
    if (tenants.error) throw new Error('GRANTS_FAILED')
    const active = z.array(z.object({ tenantId: z.uuid() })).parse(tenants.data)
    for (const { tenantId } of active) {
      if (tenantId !== env.ZETTLE_PILOT_TENANT_ID) continue
      try {
        await run(client, tenantId, env)
      } catch {
        failed = true
      }
    }
  } catch {
    failed = true
  } finally {
    try {
      const signedOut = await client.auth.signOut({ scope: 'local' })
      if (signedOut.error) failed = true
    } catch {
      failed = true
    }
  }
  return failed
    ? reply(500, { error: 'ZETTLE_AUTOMATION_FAILED' })
    : reply(200, { ok: true })
}
