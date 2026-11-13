import { createClient } from '@supabase/supabase-js'
import { supabaseEnv } from '@/lib/supabase/env'
import { readMySellerAccounts } from '@/lib/engine/seller-portal'

export class MobileRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export function mobileOrigin(request: Request): string | null {
  const origin = request.headers.get('origin')
  // Native apps do not send Origin. Identity still requires a verified bearer.
  if (origin === null) return null
  const allowed = (process.env.KOMISIO_MOBILE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => {
      try {
        const url = new URL(entry)
        return (
          url.origin === entry &&
          (url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        )
      } catch {
        return false
      }
    })
  if (!allowed.includes(origin)) throw new MobileRequestError('FORBIDDEN', 403)
  return origin
}

async function mobileVerifiedClient(
  request: Request,
  identity: 'email' | 'phone' | 'push',
  serverHeaders: Record<string, string> = {},
) {
  const authorization = request.headers.get('authorization') ?? ''
  const token =
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
      authorization,
    )?.[1]
  if (!token || token.length > 16384)
    throw new MobileRequestError('AUTH_REQUIRED', 401)
  const { url, key } = supabaseEnv()
  // Deliberately stateless: cookies and any staff session cannot supply identity.
  const client = createClient(url, key, {
    global: { headers: { ...serverHeaders, Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error) {
    const invalid = error.status === 401 || error.status === 403
    throw new MobileRequestError(
      invalid ? 'AUTH_REQUIRED' : 'REQUEST_FAILED',
      invalid ? 401 : 503,
    )
  }
  if (!data.user) throw new MobileRequestError('AUTH_REQUIRED', 401)
  if (identity === 'email' && !data.user.email_confirmed_at)
    throw new MobileRequestError('AUTH_REQUIRED', 401)
  if (
    identity === 'push' &&
    !data.user.email_confirmed_at &&
    !(data.user.phone_confirmed_at && data.user.phone)
  )
    throw new MobileRequestError('AUTH_REQUIRED', 401)
  if (
    identity === 'phone' &&
    (!data.user.phone_confirmed_at || !data.user.phone)
  )
    throw new MobileRequestError('PHONE_VERIFICATION_REQUIRED', 403)
  if (data.user.app_metadata.komisio_password_recovery_pending === true)
    throw new MobileRequestError('PASSWORD_UPDATE_REQUIRED', 409)
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel(token)
  if (
    assurance.error ||
    !assurance.data ||
    !['aal1', 'aal2'].includes(assurance.data.nextLevel ?? '')
  )
    throw new MobileRequestError('REQUEST_FAILED', 503)
  if (!['aal1', 'aal2'].includes(assurance.data.currentLevel ?? ''))
    throw new MobileRequestError('AUTH_REQUIRED', 401)
  if (
    assurance.data.nextLevel === 'aal2' &&
    assurance.data.currentLevel !== 'aal2'
  )
    throw new MobileRequestError('MFA_REQUIRED', 403)
  return client
}

/** Existing seller, bank and payout commands retain email verification. */
export function mobileIdentityClient(request: Request) {
  return mobileVerifiedClient(request, 'email')
}

/** External intake only; never a substitute for the registered-seller boundary. */
export function mobilePhoneClient(request: Request) {
  return mobileVerifiedClient(request, 'phone')
}

/** Server capability is never copied from a caller-controlled header. */
export function mobileShippingClient(request: Request, serverKey: string) {
  return mobileVerifiedClient(request, 'phone', {
    'x-komisio-shipping': serverKey,
  })
}

/** The capability is server-owned; incoming request headers cannot supply it. */
export function mobilePhotoAiClient(request: Request) {
  const key = process.env.KOMISIO_SELLER_AI_SERVER_KEY
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error('ASSISTANCE_DISABLED')
  return mobileVerifiedClient(request, 'phone', { 'x-komisio-seller-ai': key })
}

/** Installation consent only; the engine separately checks event ownership. */
export function mobilePushClient(request: Request) {
  return mobileVerifiedClient(request, 'push')
}

export async function mobileSellerClient(
  request: Request,
  tenant: string,
  seller: string,
) {
  const client = await mobileIdentityClient(request)
  const accounts = await readMySellerAccounts(client)
  if (
    accounts.filter((a) => a.tenantId === tenant && a.sellerId === seller)
      .length !== 1
  )
    throw new MobileRequestError('FORBIDDEN', 403)
  return client
}

export async function mobileJson(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim() !==
    'application/json'
  )
    throw new MobileRequestError('INVALID_INPUT', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new MobileRequestError('INVALID_INPUT', 400)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 8192) {
        await reader.cancel()
        throw new MobileRequestError('INVALID_INPUT', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    )
  } catch {
    throw new MobileRequestError('INVALID_INPUT', 400)
  }
}
