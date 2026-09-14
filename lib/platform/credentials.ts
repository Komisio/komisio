import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto'
import { z } from 'zod'

// Server-side credential sealing. Provider tokens are encrypted with a key the
// database never sees (KOMISIO_CREDENTIAL_KEY, 32 bytes as 64 hex characters)
// and stored as ciphertext through engine functions; a database read alone
// cannot recover a token. The same key signs short-lived OAuth state.
export const sealedBox = z.strictObject({
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string().min(1),
})
export type SealedBox = z.infer<typeof sealedBox>

function keyFrom(env: Record<string, string | undefined>) {
  const hex = env.KOMISIO_CREDENTIAL_KEY?.trim() ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('CREDENTIAL_KEY_MISSING')
  return Buffer.from(hex, 'hex')
}

export function credentialKeyConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return /^[0-9a-f]{64}$/i.test(env.KOMISIO_CREDENTIAL_KEY?.trim() ?? '')
}

/** AES-256-GCM; the purpose string is bound as associated data so a box cannot be replayed elsewhere. */
export function seal(
  purpose: string,
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): SealedBox {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(env), iv)
  cipher.setAAD(Buffer.from(purpose))
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

export function open(
  purpose: string,
  boxInput: unknown,
  env: Record<string, string | undefined> = process.env,
): unknown {
  const box = sealedBox.parse(boxInput)
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(env),
    Buffer.from(box.iv, 'base64'),
  )
  decipher.setAAD(Buffer.from(purpose))
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
  try {
    const text = Buffer.concat([
      decipher.update(Buffer.from(box.data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    return JSON.parse(text)
  } catch {
    throw new Error('CREDENTIAL_UNREADABLE')
  }
}

/** Signed, expiring state for OAuth round trips; the signature covers purpose and payload. */
export function signState(
  purpose: string,
  payload: Record<string, string>,
  ttlSeconds: number,
  env: Record<string, string | undefined> = process.env,
) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }),
  ).toString('base64url')
  const mac = createHmac('sha256', keyFrom(env))
    .update(`${purpose}.${body}`)
    .digest('base64url')
  return `${body}.${mac}`
}

export function verifyState(
  purpose: string,
  state: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> | null {
  if (!state || state.length > 4096) return null
  const [body, mac] = state.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', keyFrom(env))
    .update(`${purpose}.${body}`)
    .digest('base64url')
  if (expected.length !== mac.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const parsed = z
      .object({ exp: z.number() })
      .passthrough()
      .parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
    if (parsed.exp < Date.now()) return null
    const { exp: _exp, ...rest } = parsed
    void _exp
    return Object.fromEntries(
      Object.entries(rest).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>
  } catch {
    return null
  }
}
