import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  authEndpoint,
  boundedJson,
  deviceScope,
  issuePrinterCredential,
  validToken,
} from './auth.mjs'
import { createEnrollmentStore } from './enrollment-store.mjs'
import { createCredentialStore } from './credentials.mjs'
import { createAttemptStore } from './attempts.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const phases = [
  'fresh',
  'signing_up',
  'ready_to_pair',
  'refreshing',
  'pairing',
  'publishing',
  'complete',
]
const error = (code) => new Error(`PRINT_ENROLLMENT_${code}`)

/**
 * Uses the existing anonymous Auth + one-use device pairing contract. The code
 * is never stored. A lost pair reply is recovered ONLY by reading that session's
 * context; it cannot silently create another identity or submit the code again.
 * The returned printer password is secret: write it to private operator output,
 * never logs, URLs, terminal history or public installation artifacts.
 */
export async function enrollWeblinkDevice({
  directory,
  encryptionKey,
  url,
  publishableKey,
  tenantId,
  printerId,
  deviceName,
  pairingCode,
  fetchImpl = fetch,
}) {
  const endpoint = authEndpoint(url, publishableKey)
  if (
    !uuid.test(tenantId ?? '') ||
    !uuid.test(printerId ?? '') ||
    typeof deviceName !== 'string' ||
    !deviceName.trim() ||
    deviceName.length > 80 ||
    /[\x00-\x1f\x7f]/.test(deviceName)
  )
    throw error('INVALID_INPUT')
  const binding = {
    url: endpoint.href,
    publishableKey,
    tenantId,
    printerId,
    deviceName: deviceName.trim(),
  }
  const normalizedCode =
    typeof pairingCode === 'string'
      ? pairingCode.trim().replace('-', '').toUpperCase()
      : ''
  const store = await createEnrollmentStore(directory, encryptionKey)
  let state, accessToken
  async function checkpoint(change) {
    const next = { ...state, ...change }
    await store.save(next)
    state = next
  }
  async function request(path, body, token) {
    try {
      const response = await fetchImpl(new URL(path, endpoint), {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw error('REMOTE_UNKNOWN')
      }
      return await boundedJson(response, 24000)
    } catch {
      throw error('REMOTE_UNKNOWN')
    }
  }
  function session(result) {
    if (
      !validToken(result?.access_token, 16384) ||
      !validToken(result?.refresh_token, 8192) ||
      !uuid.test(result.user?.id ?? '') ||
      result.user?.is_anonymous !== true ||
      (state.userId && result.user.id !== state.userId)
    )
      throw error('SESSION_UNKNOWN')
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      userId: result.user.id,
    }
  }
  async function publish() {
    const scope = deviceScope({ tenantId, printerId, deviceId: state.deviceId })
    const destination = join(directory, 'device')
    const credentials = await createCredentialStore(destination, encryptionKey)
    // Share runtime ownership: publishing must never overwrite a rotated token.
    const owner = await createAttemptStore(join(destination, 'attempts'), scope)
    try {
      const existing = await credentials.load(scope.deviceId)
      const secretDigest = createHash('sha256')
        .update(state.password, 'ascii')
        .digest('hex')
      if (existing) {
        if (
          existing.tenantId !== tenantId ||
          existing.printerId !== printerId ||
          existing.secretDigest !== secretDigest
        )
          throw error('BINDING_CONFLICT')
      } else {
        if (state.phase === 'complete' || !validToken(state.refreshToken, 8192))
          throw error('CREDENTIAL_MISSING')
        await credentials.save({
          ...scope,
          secretDigest,
          refreshToken: state.refreshToken,
        })
      }
      await checkpoint({ phase: 'complete', refreshToken: null })
      return Object.freeze({
        ...scope,
        directory: destination,
        password: state.password,
      })
    } finally {
      await owner.close()
    }
  }
  try {
    state = await store.load()
    if (!state) {
      if (!/^[0-9A-F]{10}$/.test(normalizedCode)) throw error('INVALID_CODE')
      state = {
        version: 1,
        binding,
        phase: 'fresh',
        password: issuePrinterCredential().password,
        refreshToken: null,
        userId: null,
        deviceId: null,
      }
      await store.save(state)
    }
    if (
      state.version !== 1 ||
      JSON.stringify(state.binding) !== JSON.stringify(binding) ||
      !phases.includes(state.phase) ||
      !/^[A-Za-z0-9_-]{43}$/.test(state.password ?? '')
    )
      throw error('BINDING_CONFLICT')
    if (['signing_up', 'refreshing'].includes(state.phase))
      throw error('SESSION_UNKNOWN')
    if (['publishing', 'complete'].includes(state.phase)) return await publish()
    if (
      ['fresh', 'ready_to_pair'].includes(state.phase) &&
      !/^[0-9A-F]{10}$/.test(normalizedCode)
    )
      throw error('INVALID_CODE')
    if (state.phase === 'fresh') {
      await checkpoint({ phase: 'signing_up' })
      const result = session(await request('/auth/v1/signup', {}))
      await checkpoint({
        phase: 'ready_to_pair',
        refreshToken: result.refreshToken,
        userId: result.userId,
      })
      accessToken = result.accessToken
    }
    if (!accessToken) {
      if (
        !validToken(state.refreshToken, 8192) ||
        !uuid.test(state.userId ?? '')
      )
        throw error('SESSION_UNKNOWN')
      const resumePhase = state.phase
      await checkpoint({ phase: 'refreshing' })
      const result = session(
        await request('/auth/v1/token?grant_type=refresh_token', {
          refresh_token: state.refreshToken,
        }),
      )
      await checkpoint({
        phase: resumePhase,
        refreshToken: result.refreshToken,
      })
      accessToken = result.accessToken
    }
    if (state.phase === 'ready_to_pair') {
      await checkpoint({ phase: 'pairing' })
      await request(
        '/rest/v1/rpc/pair_print_device',
        {
          p_code: normalizedCode,
          p_name: binding.deviceName,
          p_version: 'weblink-0.1',
        },
        accessToken,
      )
    }
    let context
    try {
      context = await request(
        '/rest/v1/rpc/print_device_context',
        {},
        accessToken,
      )
    } catch {
      throw error('PAIRING_UNKNOWN')
    }
    if (
      context?.tenantId !== tenantId ||
      context?.printerId !== printerId ||
      context?.transport !== 'weblink' ||
      !uuid.test(context?.deviceId ?? '') ||
      typeof context.active !== 'boolean'
    )
      throw error('BINDING_CONFLICT')
    await checkpoint({ phase: 'publishing', deviceId: context.deviceId })
    return await publish()
  } finally {
    await store.close()
  }
}
