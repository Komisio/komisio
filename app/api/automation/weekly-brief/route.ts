import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  automationIdentity,
  acceptAutomationGrants,
} from '@/lib/engine/automation'
import { sendWeeklyBriefs } from '@/lib/engine/weekly-brief'
import { supabaseEnv } from '@/lib/supabase/env'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Mondays (Vercel Cron): last week's brief to the owners of stores that switched it on. */
export async function GET(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  const secret = process.env.CRON_SECRET ?? ''
  const origin = process.env.NEXT_PUBLIC_APP_URL
  const identity = automationIdentity()
  if (secret.length < 16 || !origin || !identity)
    return reply({ error: 'NOT_FOUND' }, 404)
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return reply({ error: 'FORBIDDEN' }, 403)
  const { url, key } = supabaseEnv()
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const signIn = await client.auth.signInWithPassword(identity)
    if (signIn.error) return reply({ error: 'AUTOMATION_UNAVAILABLE' }, 503)
    await acceptAutomationGrants(client)
    const outcome = await sendWeeklyBriefs(client, new URL(origin).origin)
    return reply({ ...outcome, briefs: outcome.results.length })
  } catch (e) {
    console.error('Weekly brief failed', {
      code: e instanceof Error ? e.message : 'unknown',
    })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  } finally {
    await client.auth.signOut().catch(() => undefined)
  }
}
