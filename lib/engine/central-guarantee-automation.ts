import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { acceptAutomationGrants, automationIdentity } from './automation'

export async function runCentralGuarantees(
  client: SupabaseClient,
  tenant: string,
) {
  const result = await client.rpc('run_central_guarantees', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (result.error) throw new Error('GUARANTEE_AUTOMATION_FAILED')
  return z
    .object({ processed: z.number().int().min(0).max(100), more: z.boolean() })
    .parse(result.data)
}

export async function handleCentralGuaranteeCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runCentralGuarantees,
) {
  const reply = (status: number, body: object) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  const identity = automationIdentity(env),
    secret = env.CRON_SECRET
  if (
    env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    env.KOMISIO_CENTRAL_GUARANTEES_ENABLED !== 'true' ||
    !identity ||
    !secret ||
    secret.length < 16 ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return reply(404, { error: 'NOT_FOUND' })
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(request.headers.get('authorization') ?? '')
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
  let failed = false,
    processed = 0,
    more = false
  try {
    const signed = await client.auth.signInWithPassword(identity)
    if (signed.error) throw new Error('AUTH_FAILED')
    await acceptAutomationGrants(client)
    const tenants = await client.rpc('central_guarantee_automation_tenants')
    if (tenants.error) throw new Error('GRANTS_FAILED')
    const active = z
      .array(z.object({ tenantId: z.uuid() }))
      .max(1)
      .parse(tenants.data)
    for (const { tenantId } of active) {
      const result = await run(client, tenantId)
      processed += result.processed
      more = result.more
    }
  } catch {
    failed = true
  } finally {
    try {
      if ((await client.auth.signOut({ scope: 'local' })).error) failed = true
    } catch {
      failed = true
    }
  }
  return failed
    ? reply(500, { error: 'GUARANTEE_AUTOMATION_FAILED' })
    : reply(200, { ok: true, processed, more })
}
