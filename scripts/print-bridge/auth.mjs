import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SECRET = /^[A-Za-z0-9_-]{43}$/
const DIGEST = /^[a-f0-9]{64}$/
const keys = ['tenantId', 'printerId', 'deviceId']
const denied = () => new Error('PRINT_DEVICE_UNAUTHORIZED')

export function deviceScope(value) {
  if (
    !value ||
    keys.some((key) => typeof value[key] !== 'string' || !UUID.test(value[key]))
  )
    throw denied()
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])))
}

function sameScope(left, right) {
  return keys.every((key) => left[key] === right[key])
}

function digest(secret) {
  return createHash('sha256').update(secret, 'ascii').digest('hex')
}

/** Provision out of band over TLS. Never put this password in a URL or log. */
export function issuePrinterCredential() {
  const password = randomBytes(32).toString('base64url')
  return Object.freeze({ password, secretDigest: digest(password) })
}

function parseBasic(header) {
  if (typeof header !== 'string' || header.length > 200) throw denied()
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header)
  if (!match) throw denied()
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.toString('base64') !== match[1]) throw denied()
  const [deviceId, password, extra] = bytes.toString('utf8').split(':')
  if (
    !UUID.test(deviceId) ||
    !SECRET.test(password ?? '') ||
    extra !== undefined
  )
    throw denied()
  return { deviceId, secretDigest: digest(password) }
}

/**
 * No listener or queue consumer. The future TLS upgrade handler must authenticate
 * BOTH main and raw requests. Handles are private in-process capabilities, never
 * printer-supplied IDs. One service process owns each device's connections.
 */
export function createPrinterSessions({ lookupCredential, authorizeDevice }) {
  const current = new Map()
  const mainHandles = new WeakMap()
  const rawHandles = new WeakMap()

  async function validate(deviceId, secretDigest, expectedScope) {
    try {
      const record = await lookupCredential(deviceId)
      const scope = deviceScope(record)
      if (
        scope.deviceId !== deviceId ||
        !DIGEST.test(record.secretDigest ?? '') ||
        !timingSafeEqual(
          Buffer.from(secretDigest, 'hex'),
          Buffer.from(record.secretDigest, 'hex'),
        ) ||
        (expectedScope && !sameScope(scope, expectedScope)) ||
        (await authorizeDevice(scope)) !== true
      )
        throw denied()
      return scope
    } catch {
      // Credential files, HTTP errors and provider bodies may contain secrets.
      throw denied()
    }
  }

  function isCurrent(session) {
    return session && current.get(session.scope.deviceId) === session
  }

  async function openMain(header) {
    const supplied = parseBasic(header)
    const scope = await validate(supplied.deviceId, supplied.secretDigest)
    const session = { scope, secretDigest: supplied.secretDigest, raw: null }
    const handle = Object.freeze({})
    mainHandles.set(handle, session)
    current.set(scope.deviceId, session)
    return handle
  }

  async function openRaw(mainHandle, header) {
    const session = mainHandles.get(mainHandle)
    const supplied = parseBasic(header)
    if (
      !isCurrent(session) ||
      session.raw ||
      supplied.deviceId !== session.scope.deviceId
    )
      throw denied()
    await validate(supplied.deviceId, supplied.secretDigest, session.scope)
    if (
      !isCurrent(session) ||
      session.raw ||
      supplied.secretDigest !== session.secretDigest
    )
      throw denied()
    const handle = Object.freeze({})
    session.raw = handle
    rawHandles.set(handle, session)
    return handle
  }

  async function authorize(rawHandle, input) {
    try {
      const scope = deviceScope(input)
      const session = rawHandles.get(rawHandle)
      if (
        !isCurrent(session) ||
        session.raw !== rawHandle ||
        !sameScope(session.scope, scope)
      )
        return false
      await validate(scope.deviceId, session.secretDigest, scope)
      // Reconnect/disconnect may have occurred during the database round trip.
      return isCurrent(session) && session.raw === rawHandle
    } catch {
      return false
    }
  }

  function close(handle) {
    const main = mainHandles.get(handle)
    if (isCurrent(main)) current.delete(main.scope.deviceId)
    const raw = rawHandles.get(handle)
    if (raw?.raw === handle) raw.raw = null
    mainHandles.delete(handle)
    rawHandles.delete(handle)
  }

  return Object.freeze({ openMain, openRaw, authorize, close })
}

/** Uses only the existing device-context RPC; no queue writes or admin client. */
export function createDeviceAuthorizer({
  url,
  publishableKey,
  getAccessToken,
  fetchImpl = fetch,
}) {
  const endpoint = authEndpoint(url, publishableKey)

  return async (input) => {
    try {
      const scope = deviceScope(input)
      const token = await getAccessToken(scope)
      if (!validToken(token, 16384)) return false
      const response = await fetchImpl(
        new URL('/rest/v1/rpc/print_device_context', endpoint),
        {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        },
      )
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return false
      }
      const context = await boundedJson(response)
      return context?.active === true && sameScope(deviceScope(context), scope)
    } catch {
      return false
    }
  }
}

function authEndpoint(url, publishableKey) {
  const endpoint = new URL(url)
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    !(
      endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(endpoint.hostname))
    ) ||
    !isPublicKey(publishableKey)
  )
    throw new Error('INVALID_PRINT_AUTH_CONFIG')

  return endpoint
}

function validToken(value, maximum) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\r\n]/.test(value)
  )
}

/** One token provider/writer per paired device. It never signs up or grants roles. */
export function createDeviceTokenProvider({
  url,
  publishableKey,
  scope: input,
  store,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const endpoint = authEndpoint(url, publishableKey)
  const scope = deviceScope(input)
  let cached
  let pending

  async function refresh(record) {
    const response = await fetchImpl(
      new URL('/auth/v1/token?grant_type=refresh_token', endpoint),
      {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: record.refreshToken }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw denied()
    }
    const result = await boundedJson(response)
    if (
      !validToken(result?.access_token, 16384) ||
      !validToken(result?.refresh_token, 8192) ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 30 ||
      result.expires_in > 86400
    )
      throw denied()
    const expiresAt = now() + (result.expires_in - 30) * 1000
    // Never expose the access token before its replacement refresh credential is
    // durable. Storage conflicts or uncertain refresh outcomes stop this attempt.
    const revision = await store.save(
      { ...record, refreshToken: result.refresh_token },
      record.revision,
    )
    cached = { token: result.access_token, expiresAt, revision }
  }

  return async (requested) => {
    if (!sameScope(deviceScope(requested), scope)) throw denied()
    // Coalesce the entire read/refresh sequence. A delayed stale read must not
    // start a second remote refresh just after the first rotation completes.
    if (!pending)
      pending = (async () => {
        const record = await store.load(scope.deviceId)
        if (!sameScope(deviceScope(record), scope)) throw denied()
        if (cached?.revision === record.revision && cached.expiresAt > now())
          return cached.token
        await refresh(record)
        const latest = await store.load(scope.deviceId)
        if (
          latest?.revision !== cached?.revision ||
          !sameScope(deviceScope(latest), scope) ||
          cached.expiresAt <= now()
        )
          throw denied()
        return cached.token
      })()
        .catch(() => {
          cached = undefined
          throw denied()
        })
        .finally(() => {
          pending = undefined
        })
    return pending
  }
}

function isPublicKey(key) {
  if (typeof key !== 'string' || key.length > 4096) return false
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  try {
    // This is a configuration guard, not JWT verification. Supabase verifies
    // the key/session. Refuse accidentally configured service-role credentials.
    return (
      JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'
    )
  } catch {
    return false
  }
}

async function boundedJson(response) {
  if (!response.body) throw denied()
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 16384) throw denied()
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
