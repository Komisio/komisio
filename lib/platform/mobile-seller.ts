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

export async function mobileSellerClient(
  request: Request,
  tenant: string,
  seller: string,
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
    global: { headers: { Authorization: `Bearer ${token}` } },
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
  if (!data.user || !data.user.email_confirmed_at)
    throw new MobileRequestError('AUTH_REQUIRED', 401)
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
