import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { supabaseEnv } from '../supabase/env'

export function guestPhotoServerKey(
  env: Record<string, string | undefined> = process.env,
) {
  const key = env.KOMISIO_SELLER_AI_SERVER_KEY
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error('ASSISTANCE_DISABLED')
  return key
}
export function guestPhotoClient() {
  const serverKey = guestPhotoServerKey()
  const { url, key } = supabaseEnv()
  return createClient(url, key, {
    global: { headers: { 'x-komisio-seller-ai': serverKey } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
export function guestPhotoNetworkHash(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  // Only Vercel's overwritten header is trusted. Self-hosting uses one bounded
  // shared bucket until an operator supplies a trusted proxy implementation.
  const ip =
    env.VERCEL === '1'
      ? request.headers.get('x-vercel-forwarded-for')?.trim()
      : null
  return createHmac('sha256', guestPhotoServerKey(env))
    .update(`guest-photo-network:${ip && isIP(ip) ? ip : 'shared'}`)
    .digest('hex')
}
